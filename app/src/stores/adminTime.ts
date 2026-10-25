// The box's clock (calaos_base docs/08_http_api.md, "Heure de la box").
// Session only. A timezone change needs calaos-server (and the kiosk)
// restarted, which `restartRequired` says, even after a partial failure.

import { ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { timeReadBack, timeSetParams, toBoxTime, toTimeSetResult, toTimeZones } from '../protocol/admin-time';
import type { BoxTime, TimeChange, TimeReadBack } from '../protocol/admin-time';
import { isPanelError } from '../protocol/admin';
import type { AdminError } from '../protocol/admin';
import { useAdminStore } from './admin';

/**
 * `time_get` does not wait for a `time_set` still running on the daemon: a
 * step missing from the first read-back may yet land, so it is only taken as
 * missing on a read at least this long after the first.
 */
export const TIME_RECHECK_MS = 5_000;

/** `settled`: every step took, or a later read confirmed the missing ones. */
export type TimeUnconfirmed = TimeReadBack & { settled: boolean };

export const useAdminTimeStore = defineStore('adminTime', () => {
    const admin = useAdminStore();

    /** null until read. */
    const time = ref<BoxTime | null>(null);
    /** Browser clock (ms epoch) when `time` was read, to tell the drift apart from the delay. */
    const readAt = ref(0);
    const zones = ref<string[] | null>(null);
    const error = ref<AdminError | null>(null);
    /** The last change left a restart to do. */
    const restartRequired = ref(false);
    /**
     * The last change got no answer in time (it may have applied): what a
     * read of the box then showed, or 'unread' while that read failed.
     */
    const unconfirmed = ref<TimeUnconfirmed | 'unread' | null>(null);

    /** The change `unconfirmed` is about, to check again; `firstRead` 0 until a read succeeded. */
    let check: { change: TimeChange; before: BoxTime | null; sentAt: number; firstRead: number } | null = null;
    let recheckTimer: ReturnType<typeof setTimeout> | null = null;

    watch(
        () => admin.session,
        (session) => {
            if (session === null && admin.busy !== 'set' && admin.busy !== 'unlock') reset();
        },
    );

    async function load(): Promise<boolean> {
        const outcome = await admin.relay('time_get', undefined, false, isPanelError);
        if (outcome.ok) {
            time.value = toBoxTime(outcome.data.result);
            readAt.value = Date.now();
            error.value = null;
            return time.value !== null;
        }
        if (admin.gate === 'unlocked') error.value = outcome.error;
        return false;
    }

    async function loadZones(): Promise<void> {
        if (zones.value !== null) return;
        const outcome = await admin.relay('time_zones', undefined, false, isPanelError);
        if (outcome.ok) zones.value = toTimeZones(outcome.data.result);
        else if (admin.gate === 'unlocked') error.value = outcome.error;
    }

    /** null on success; the error otherwise, `applied` / `failed` filled for a partial one. */
    async function set(change: TimeChange): Promise<AdminError | null> {
        const before = time.value;
        const sentAt = Date.now();
        const outcome = await admin.relay('time_set', timeSetParams(change), true, isPanelError);
        if (outcome.ok || outcome.error.code !== 'busy') clearCheck();
        // Resending could step the clock twice: read what the box did instead.
        if (!outcome.ok && outcome.error.outcomeUnknown) {
            check = { change, before, sentAt, firstRead: 0 };
            await checkAgain();
            return null;
        }
        if (outcome.ok) {
            const result = toTimeSetResult(outcome.data.result);
            if (result !== null) {
                time.value = result.time;
                readAt.value = Date.now();
                if (result.restartRequired) restartRequired.value = true;
            }
            return null;
        }
        if (outcome.error.restartRequired) restartRequired.value = true;
        // Steps before the failure stay applied: show the real state.
        if (outcome.error.code === 'internal' && outcome.error.applied.length > 0) void load();
        return outcome.error;
    }

    /** Reads the box after a change that got no answer, and says which of its steps took. */
    async function checkAgain(): Promise<void> {
        const pending = check;
        if (pending === null) return;
        const read = await load();
        if (check !== pending) return;
        if (!read || time.value === null) {
            unconfirmed.value = 'unread';
            return;
        }
        const result = timeReadBack(pending.change, pending.before, time.value, readAt.value - pending.sentAt);
        if (result.restartRequired) restartRequired.value = true;
        if (pending.firstRead === 0) pending.firstRead = readAt.value;
        const settled = result.unchanged.length === 0 || readAt.value - pending.firstRead >= TIME_RECHECK_MS;
        unconfirmed.value = { ...result, settled };
        if (settled) {
            check = null;
            return;
        }
        if (recheckTimer === null) {
            recheckTimer = setTimeout(() => {
                recheckTimer = null;
                void checkAgain();
            }, TIME_RECHECK_MS);
        }
    }

    function clearCheck(): void {
        if (recheckTimer !== null) clearTimeout(recheckTimer);
        recheckTimer = null;
        unconfirmed.value = null;
        check = null;
    }

    function dismissUnconfirmed(): void {
        clearCheck();
    }

    function dismissRestart(): void {
        restartRequired.value = false;
    }

    function reset(): void {
        time.value = null;
        readAt.value = 0;
        zones.value = null;
        error.value = null;
        restartRequired.value = false;
        clearCheck();
    }

    return {
        time,
        readAt,
        zones,
        error,
        restartRequired,
        unconfirmed,
        load,
        loadZones,
        set,
        checkAgain,
        dismissUnconfirmed,
        dismissRestart,
        reset,
    };
});
