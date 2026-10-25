// The box's services: their state, and the restart of those the daemon
// allows (calaos_base docs/08_http_api.md, "Services"). Session only.

import { ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { SELF_SERVICE_ID, servicesRestartParams, toServices } from '../protocol/admin-services';
import type { ServiceState } from '../protocol/admin-services';
import type { AdminError } from '../protocol/admin';
import { useAdminStore } from './admin';

/** A drop this soon after restarting calaos-server is that restart, not a failure. */
export const SELF_RESTART_DROP_MS = 5_000;

export type RestartOutcome = 'restarting' | 'self_restarting' | 'failed';

export const useAdminServicesStore = defineStore('adminServices', () => {
    const admin = useAdminStore();

    /** null until read. */
    const services = ref<ServiceState[] | null>(null);
    const error = ref<AdminError | null>(null);
    /** When calaos-server was last asked to restart (ms epoch), for the drop that follows. */
    const selfRestartAt = ref<number | null>(null);

    let listSeq = 0;

    watch(
        () => admin.session,
        (session) => {
            if (session === null && admin.busy !== 'set' && admin.busy !== 'unlock') reset();
        },
    );

    async function load(): Promise<ServiceState[] | null> {
        listSeq += 1;
        const seq = listSeq;
        const outcome = await admin.relay('services_list', undefined, false);
        if (seq !== listSeq) return services.value;
        if (outcome.ok) {
            services.value = toServices(outcome.data.result);
            error.value = null;
            return services.value;
        }
        if (admin.gate === 'unlocked') error.value = outcome.error;
        return null;
    }

    /**
     * Schedules a restart (or a run, for a oneshot). The answer says nothing
     * of the outcome: the caller polls `load()`. Restarting calaos-server
     * cuts this very connection, which is the restart working.
     */
    async function restart(id: string): Promise<{ outcome: RestartOutcome; error: AdminError | null }> {
        const self = id === SELF_SERVICE_ID;
        if (self) selfRestartAt.value = Date.now();
        const outcome = await admin.relay('services_restart', servicesRestartParams(id), true);
        if (outcome.ok) {
            return { outcome: self ? 'self_restarting' : 'restarting', error: null };
        }
        if (self && outcome.error.code === 'disconnected' && isSelfRestartDrop()) {
            return { outcome: 'self_restarting', error: null };
        }
        if (self) selfRestartAt.value = null;
        return { outcome: 'failed', error: outcome.error };
    }

    /** The socket just dropped because of our own calaos-server restart. */
    function isSelfRestartDrop(now = Date.now()): boolean {
        return selfRestartAt.value !== null && now - selfRestartAt.value < SELF_RESTART_DROP_MS;
    }

    function reset(): void {
        listSeq += 1;
        services.value = null;
        error.value = null;
        selfRestartAt.value = null;
    }

    return { services, error, selfRestartAt, load, restart, isSelfRestartDrop, reset };
});
