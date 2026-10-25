// The box's clock (calaos_base docs/08_http_api.md, "Heure de la box").
// Session only. A timezone change needs calaos-server (and the kiosk)
// restarted, which `restartRequired` says, even after a partial failure.

import { ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { timeSetParams, toBoxTime, toTimeSetResult, toTimeZones } from '../protocol/admin-time';
import type { BoxTime, TimeChange } from '../protocol/admin-time';
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

    watch(
        () => admin.session,
        (session) => {
            if (session === null && admin.busy !== 'set' && admin.busy !== 'unlock') reset();
        },
    );

    async function load(): Promise<void> {
        const outcome = await admin.relay('time_get', undefined, false);
        if (outcome.ok) {
            time.value = toBoxTime(outcome.data.result);
            readAt.value = Date.now();
            error.value = null;
        } else if (admin.gate === 'unlocked') {
            error.value = outcome.error;
        }
    }

    async function loadZones(): Promise<void> {
        if (zones.value !== null) return;
        const outcome = await admin.relay('time_zones', undefined, false);
        if (outcome.ok) zones.value = toTimeZones(outcome.data.result);
        else if (admin.gate === 'unlocked') error.value = outcome.error;
    }

    /** null on success; the error otherwise, `applied` / `failed` filled for a partial one. */
    async function set(change: TimeChange): Promise<AdminError | null> {
        const outcome = await admin.relay('time_set', timeSetParams(change), true);
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

    function dismissRestart(): void {
        restartRequired.value = false;
    }

    function reset(): void {
        time.value = null;
        readAt.value = 0;
        zones.value = null;
        error.value = null;
        restartRequired.value = false;
    }

    return { time, readAt, zones, error, restartRequired, load, loadZones, set, dismissRestart, reset };
});
