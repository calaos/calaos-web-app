// The box's btrfs snapshots, booting one for rescue, and the way back
// (calaos_base docs/08_http_api.md, "Snapshots and rescue"). Session only.
//
// `admin_unavailable` and the snapshot codes are shown by the panel: they say
// nothing about the rest of the Admin page, so the gate is left alone.

import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { snapshotBootParams } from '../protocol/admin-snapshots';
import type { SnapshotList } from '../protocol/admin-snapshots';
import { isPanelError } from '../protocol/admin';
import type { AdminError } from '../protocol/admin';
import { toSnapshotList } from '../protocol/admin-snapshots';
import { useAdminStore } from './admin';
import { useAuthStore } from './auth';
import { useConnectionStore } from './connection';
import { useRescueStore } from './rescue';

/** The box normally answers again within a minute or two; later, stop claiming it is rebooting. */
export const REBOOT_DEADLINE_MS = 180_000;

const SNAPSHOT_CODES: readonly string[] = [
    'invalid_snapshot',
    'not_bootable',
    'snapshot_too_old',
    'in_rescue',
    'not_in_rescue',
    'rescue_unavailable',
];

/** idle; sending: waiting for the reply; rebooting: the box is going down or is down. */
export type SnapshotPhase = 'idle' | 'sending' | 'rebooting';
export type SnapshotAction = 'boot' | 'rollback' | 'return';

export function isLocalSnapshotError(error: AdminError): boolean {
    return isPanelError(error) || error.code === 'admin_unavailable' || SNAPSHOT_CODES.includes(error.code);
}

export const useAdminSnapshotsStore = defineStore('adminSnapshots', () => {
    const admin = useAdminStore();
    const auth = useAuthStore();
    const connection = useConnectionStore();
    const rescue = useRescueStore();

    /** null until read. */
    const list = ref<SnapshotList | null>(null);
    /** Why the list could not be read. */
    const error = ref<AdminError | null>(null);
    const phase = ref<SnapshotPhase>('idle');
    /** What the box is rebooting for. */
    const action = ref<SnapshotAction | null>(null);
    /** The refusal of the last boot, rollback or return. */
    const actionError = ref<AdminError | null>(null);
    /** The relay stopped waiting: the reboot may or may not have started. */
    const outcomeUnknown = ref(false);

    let listSeq = 0;
    let sawDrop = false;
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;

    const online = computed(() => connection.isOpen && auth.isAuthed);
    const busy = computed(() => phase.value !== 'idle');

    watch(
        () => admin.session,
        (session) => {
            if (session === null && admin.busy !== 'set' && admin.busy !== 'unlock') reset();
        },
    );

    watch(
        () => connection.isOpen,
        (open) => {
            if (phase.value === 'rebooting' && !open) sawDrop = true;
        },
    );

    watch(online, (now) => {
        if (now && phase.value === 'rebooting' && sawDrop) endReboot();
    });

    function clearDeadline(): void {
        if (deadlineTimer !== null) clearTimeout(deadlineTimer);
        deadlineTimer = null;
    }

    /** The box is back, or has stayed silent too long: read it again rather than guess. */
    function endReboot(): void {
        clearDeadline();
        phase.value = 'idle';
        action.value = null;
        outcomeUnknown.value = false;
        sawDrop = false;
        void rescue.load();
        if (admin.isUnlocked) void load();
    }

    function startReboot(kind: SnapshotAction, unknown: boolean): void {
        phase.value = 'rebooting';
        action.value = kind;
        outcomeUnknown.value = unknown;
        sawDrop = !connection.isOpen;
        clearDeadline();
        deadlineTimer = setTimeout(() => {
            deadlineTimer = null;
            if (phase.value === 'rebooting') endReboot();
        }, REBOOT_DEADLINE_MS);
    }

    async function load(): Promise<SnapshotList | null> {
        listSeq += 1;
        const seq = listSeq;
        const outcome = await admin.relay('snapshots_list', undefined, false, isLocalSnapshotError);
        if (seq !== listSeq) return list.value;
        if (outcome.ok) {
            list.value = toSnapshotList(outcome.data.result);
            error.value = null;
            return list.value;
        }
        // The connection banner already says so; the last list stays readable.
        if (outcome.error.code === 'disconnected') return null;
        if (admin.gate === 'unlocked') error.value = outcome.error;
        return null;
    }

    /**
     * An accepted action, or one whose outcome is unknown, leads to a reboot:
     * never sent again. A refusal is shown and the list read again, since it
     * usually means the screen was stale.
     */
    async function run(kind: 'boot' | 'rollback', id: number | null): Promise<void> {
        if (phase.value !== 'idle') return;
        phase.value = 'sending';
        actionError.value = null;
        const wasOpen = connection.isOpen;
        const outcome =
            kind === 'boot' && id !== null
                ? await admin.relay('snapshot_boot', snapshotBootParams(id), true, isLocalSnapshotError)
                : await admin.relay('snapshot_rollback', undefined, true, isLocalSnapshotError);
        if (outcome.ok) {
            startReboot(kind, false);
            return;
        }
        const failure = outcome.error;
        if (failure.outcomeUnknown || failure.code === 'timeout') {
            startReboot(kind, true);
            return;
        }
        if (failure.code === 'disconnected' && wasOpen) {
            // The drop is the box going down for the reboot.
            startReboot(kind, true);
            return;
        }
        phase.value = 'idle';
        if (failure.code === 'disconnected' || failure.code === 'busy') return;
        actionError.value = failure;
        if (failure.code === 'in_rescue' || failure.code === 'not_in_rescue') void rescue.load();
        if (admin.gate === 'unlocked') await load();
    }

    function boot(id: number): Promise<void> {
        return run('boot', id);
    }

    function rollback(): Promise<void> {
        return run('rollback', null);
    }

    /** "Back to the normal system" is the existing reboot of the box. */
    async function returnNormal(): Promise<void> {
        if (phase.value !== 'idle') return;
        phase.value = 'sending';
        actionError.value = null;
        const before = admin.notice;
        if (await admin.reboot()) {
            startReboot('return', false);
            return;
        }
        phase.value = 'idle';
        // A refusal lands in the admin notice, which this panel does not show.
        // When another admin action is running, reboot() returns false without
        // touching the notice: whatever is there belongs to another panel.
        if (admin.noticeSource === 'box' && admin.notice !== before) actionError.value = admin.notice;
    }

    function dismissActionError(): void {
        actionError.value = null;
    }

    function reset(): void {
        listSeq += 1;
        clearDeadline();
        list.value = null;
        error.value = null;
        phase.value = 'idle';
        action.value = null;
        actionError.value = null;
        outcomeUnknown.value = false;
        sawDrop = false;
    }

    return {
        list,
        error,
        phase,
        action,
        actionError,
        outcomeUnknown,
        busy,
        load,
        boot,
        rollback,
        returnNormal,
        dismissActionError,
        reset,
    };
});
