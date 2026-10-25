// calaos_server's own settings and the configuration backup (calaos_base
// docs/08_http_api.md, "Configuration"). Session only. A secret is never
// read back: the list only says whether one is stored.

import { ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { backupFilename, configBackupBody, configSetParams, toConfigOptions, toConfigSetResult } from '../protocol/admin-config';
import type { ConfigOption, ConfigSetResult } from '../protocol/admin-config';
import { bareAdminError, isAdminFailure, toAdminError } from '../protocol/admin';
import type { AdminError } from '../protocol/admin';
import { useAdminStore } from './admin';

export interface BackupFile {
    filename: string;
    blob: Blob;
}

export const useAdminConfigStore = defineStore('adminConfig', () => {
    const admin = useAdminStore();

    /** null until read. */
    const options = ref<ConfigOption[] | null>(null);
    const error = ref<AdminError | null>(null);
    /** A saved key needs calaos-server restarted. */
    const restartRequired = ref(false);

    watch(
        () => admin.session,
        (session) => {
            if (session === null && admin.busy !== 'set' && admin.busy !== 'unlock') reset();
        },
    );

    async function load(): Promise<void> {
        const outcome = await admin.relay('config_list', undefined, false);
        if (outcome.ok) {
            options.value = toConfigOptions(outcome.data.result);
            error.value = null;
        } else if (admin.gate === 'unlocked') {
            error.value = outcome.error;
        }
    }

    /** `value` '' restores the default. The registry's refusal comes back as `invalid_request`. */
    async function set(key: string, value: string): Promise<{ result: ConfigSetResult | null; error: AdminError | null }> {
        const outcome = await admin.relay('config_set', configSetParams(key, value), true);
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
        const filename = backupFilename(response.headers.get('content-disposition'));
        if (filename === '') {
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
        return { filename, blob: await response.blob() };
    }

    function dismissRestart(): void {
        restartRequired.value = false;
    }

    function reset(): void {
        options.value = null;
        error.value = null;
        restartRequired.value = false;
    }

    return { options, error, restartRequired, load, set, downloadBackup, dismissRestart, reset };
});
