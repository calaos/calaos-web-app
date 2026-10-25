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
    const unconfirmed = ref<TimeReadBack | 'unread' | null>(null);

    /** The change `unconfirmed` is about, to check again. */
    let check: { change: TimeChange; before: BoxTime | null; sentAt: number } | null = null;

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
        if (outcome.ok || outcome.error.code !== 'busy') {
            unconfirmed.value = null;
            check = null;
        }
        // Resending could step the clock twice: read what the box did instead.
        if (!outcome.ok && outcome.error.outcomeUnknown) {
            check = { change, before, sentAt };
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
        unconfirmed.value = result;
        check = null;
    }

    function dismissUnconfirmed(): void {
        unconfirmed.value = null;
        check = null;
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
        unconfirmed.value = null;
        check = null;
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
