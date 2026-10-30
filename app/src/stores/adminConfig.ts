// calaos_server's own settings, the configuration backup and its restore
// (calaos_base docs/08_http_api.md, "Configuration"). Session only. A secret
// is never read back: the list only says whether one is stored.

import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import {
    backupZipName,
    configBackupBody,
    configRestoreParams,
    configSetParams,
    isBackupDownload,
    toConfigBackup,
    toConfigOptions,
    toConfigRestoreResult,
    toConfigSetResult,
} from '../protocol/admin-config';
import type { ConfigBackup, ConfigOption, ConfigRestoreResult, ConfigSetResult } from '../protocol/admin-config';
import { bareAdminError, isAdminFailure, isPanelError, toAdminError } from '../protocol/admin';
import type { AdminError } from '../protocol/admin';
import { buildBackupZip } from '../protocol/backup-zip';
import { useAdminStore } from './admin';
import { SELF_RESTART_DEADLINE_MS, SELF_RESTART_DROP_MS } from './adminServices';
import { useAuthStore } from './auth';
import { useConnectionStore } from './connection';

export interface BackupFile {
    filename: string;
    blob: Blob;
}

/** The restart a restore causes, followed across the reconnection. */
export interface RestoreFollowUp {
    phase: 'restarting' | 'slow' | 'done';
    /** The `backups/` folder of the replaced files; null when the answer was lost to the restart. */
    previous: string | null;
    /** The write failed half way: the box restarts, on files that may be a mix. */
    partial: boolean;
}

export const useAdminConfigStore = defineStore('adminConfig', () => {
    const admin = useAdminStore();
    const auth = useAuthStore();
    const connection = useConnectionStore();

    /** null until read. */
    const options = ref<ConfigOption[] | null>(null);
    const error = ref<AdminError | null>(null);
    /** A saved key needs calaos-server restarted. */
    const restartRequired = ref(false);
    const restoreFollowUp = ref<RestoreFollowUp | null>(null);
    /**
     * Read by the sign-in page when the new household login is refused, so it
     * outlives the admin session and a dismissed follow-up: the box may come
     * back long after the "slow" banner was closed.
     */
    const householdChanged = ref(false);

    /** Connection and household re-login: only then has the restarted server read the restored files. */
    const online = computed(() => connection.isOpen && auth.isAuthed);

    let restoreDropped = false;
    /** Outlives a dismissed banner: the box is still to come back. */
    let restoreAwaiting = false;
    let restoreTimer: ReturnType<typeof setTimeout> | undefined;

    watch(
        () => admin.session,
        (session) => {
            if (session === null && admin.busy !== 'set' && admin.busy !== 'unlock') reset();
        },
    );

    watch(online, (now) => {
        if (!now) {
            restoreDropped = true;
            return;
        }
        if (!restoreDropped) return;
        householdChanged.value = false;
        if (!restoreAwaiting) return;
        restoreAwaiting = false;
        clearTimeout(restoreTimer);
        if (restoreFollowUp.value !== null) restoreFollowUp.value.phase = 'done';
        restartRequired.value = false;
        void load();
    });

    async function load(): Promise<void> {
        const outcome = await admin.relay('config_list', undefined, false, isPanelError);
        if (outcome.ok) {
            options.value = toConfigOptions(outcome.data.result);
            error.value = null;
        } else if (admin.gate === 'unlocked') {
            error.value = outcome.error;
        }
    }

    /** `value` '' restores the default. The registry's refusal comes back as `invalid_request`. */
    async function set(key: string, value: string): Promise<{ result: ConfigSetResult | null; error: AdminError | null }> {
        const outcome = await admin.relay('config_set', configSetParams(key, value), true, isPanelError);
        if (!outcome.ok) return { result: null, error: outcome.error };
        const result = toConfigSetResult(outcome.data.result);
        if (result !== null) {
            if (result.restartRequired) restartRequired.value = true;
            options.value =
                options.value?.map((option) =>
                    option.key === result.key
                        ? { ...option, value: option.secret ? null : result.value, set: result.set }
                        : option,
                ) ?? null;
        }
        return { result, error: null };
    }

    /**
     * The HTTP download: the answer is the backup itself, with
     * `Content-Disposition`; a refusal is the usual error payload, without it.
     */
    async function downloadBackup(fetchImpl: typeof fetch = fetch): Promise<BackupFile | AdminError> {
        const session = admin.session;
        if (session === null) return bareAdminError('bad_session');
        const { user, pass } = admin.householdCredentials();
        let response: Response;
        try {
            response = await fetchImpl('/api', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: configBackupBody(user, pass, session),
                cache: 'no-store',
            });
        } catch {
            return bareAdminError('disconnected');
        }
        // A refused household sign-in is HTTP 400 with an HTML page.
        if (response.status === 400) return bareAdminError('household_refused');
        if (!response.ok) return bareAdminError('internal');
        if (!isBackupDownload(response.headers.get('content-disposition'))) {
            let payload: unknown = null;
            try {
                payload = await response.json();
            } catch {
                // Not JSON either: an older server's text answer.
            }
            const failure = isAdminFailure(payload) ? toAdminError(payload) : bareAdminError('unknown');
            if (failure.code === 'bad_session') admin.dropSession(null);
            return failure;
        }
        let doc: ConfigBackup | null = null;
        try {
            doc = toConfigBackup(await response.json());
        } catch {
            // Reported below, like a document in an unknown format.
        }
        if (doc === null) return bareAdminError('internal');
        return { filename: backupZipName(doc.hostname, doc.createdAt), blob: buildBackupZip(doc) };
    }

    /** Validates `files` on the box and counts what would change. Nothing is written. */
    async function previewRestore(
        files: Record<string, string>,
    ): Promise<{ result: ConfigRestoreResult | null; error: AdminError | null }> {
        const outcome = await admin.relay('config_restore', configRestoreParams(files, true), true, isPanelError);
        if (!outcome.ok) return { result: null, error: outcome.error };
        const result = toConfigRestoreResult(outcome.data.result);
        return result === null ? { result: null, error: bareAdminError('unknown') } : { result, error: null };
    }

    /**
     * Replaces the files and follows the restart. A lost answer may be that
     * restart at work: it is followed too, but without claiming a success.
     */
    async function restore(files: Record<string, string>, householdChanges: boolean): Promise<AdminError | null> {
        const sentAt = Date.now();
        const outcome = await admin.relay('config_restore', configRestoreParams(files, false), true, isPanelError);
        if (outcome.ok) {
            followRestart(toConfigRestoreResult(outcome.data.result)?.previous ?? null, householdChanges, false);
            return null;
        }
        const code = outcome.error.code;
        if (code === 'timeout' || (code === 'disconnected' && Date.now() - sentAt <= SELF_RESTART_DROP_MS)) {
            followRestart(null, householdChanges, false);
            return null;
        }
        if (code === 'internal' && outcome.error.restarting) {
            followRestart(outcome.error.previous === '' ? null : outcome.error.previous, householdChanges, true);
        }
        return outcome.error;
    }

    function followRestart(previous: string | null, householdChanges: boolean, partial: boolean): void {
        restoreDropped = !online.value;
        restoreAwaiting = true;
        restoreFollowUp.value = { phase: 'restarting', previous, partial };
        // A partial restore may not have replaced the file holding the login: the hint would be a guess.
        householdChanged.value = householdChanges && !partial;
        clearTimeout(restoreTimer);
        restoreTimer = setTimeout(() => {
            if (restoreFollowUp.value?.phase === 'restarting') restoreFollowUp.value.phase = 'slow';
        }, SELF_RESTART_DEADLINE_MS);
    }

    function dismissRestore(): void {
        clearTimeout(restoreTimer);
        // A failed restore must stay told: Close only stops the wait.
        if (restoreFollowUp.value?.partial && restoreFollowUp.value.phase !== 'done') {
            restoreFollowUp.value.phase = 'done';
            return;
        }
        restoreFollowUp.value = null;
    }

    function dismissRestart(): void {
        restartRequired.value = false;
    }

    function reset(): void {
        options.value = null;
        error.value = null;
        restartRequired.value = false;
    }

    return {
        options,
        error,
        restartRequired,
        restoreFollowUp,
        householdChanged,
        load,
        set,
        downloadBackup,
        previewRestore,
        restore,
        dismissRestart,
        dismissRestore,
        reset,
    };
});
