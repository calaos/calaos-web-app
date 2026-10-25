// The box's services: their state, and the restart of those the daemon
// allows (calaos_base docs/08_http_api.md, "Services"). Session only.

import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { SELF_SERVICE_ID, servicesRestartParams, toServices } from '../protocol/admin-services';
import type { ServiceState } from '../protocol/admin-services';
import { isPanelError } from '../protocol/admin';
import type { AdminError } from '../protocol/admin';
import { useAdminStore } from './admin';
import { useAuthStore } from './auth';
import { useConnectionStore } from './connection';

/**
 * A drop this soon after restarting calaos-server is that restart, even
 * without its reply. The socket normally closes ~1 s after the reply (the
 * daemon's 500 ms, then calaos_server's SIGTERM handler); a hung shutdown
 * lasts until `podman rm -f` kills it after its 10 s stop timeout.
 */
export const SELF_RESTART_DROP_MS = 15_000;
export const RESTART_POLL_MS = 2_000;
export const RESTART_DEADLINE_MS = 60_000;
/** calaos-server also has to start its container and load the house before it answers again. */
export const SELF_RESTART_DEADLINE_MS = 120_000;

export type RestartOutcome = 'restarting' | 'self_restarting' | 'failed';

/** Where a restart this client asked for stands. */
export type RestartPhase = 'sending' | 'waiting' | 'reconnecting';

export type RestartResult =
    | { status: 'done' | 'failed' | 'not_found' | 'timeout' }
    | { status: 'error'; error: AdminError };

interface Tracked {
    phase: RestartPhase;
    /** `since` before the request: `active` alone may be the old process, not the restarted one. */
    before: string;
    /** Never `active` and `since` stays null: its run is too short for a poll to catch. */
    oneshot: boolean;
    deadline: number;
}

export const useAdminServicesStore = defineStore('adminServices', () => {
    const admin = useAdminStore();
    const auth = useAuthStore();
    const connection = useConnectionStore();

    /** null until read. */
    const services = ref<ServiceState[] | null>(null);
    const error = ref<AdminError | null>(null);
    /** When calaos-server was last asked to restart (ms epoch), for the drop that follows. */
    const selfRestartAt = ref<number | null>(null);
    const tracked = ref<Record<string, Tracked>>({});
    const results = ref<Record<string, RestartResult>>({});

    let listSeq = 0;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const restarting = computed(() => Object.keys(tracked.value).length > 0);
    const selfPhase = computed<RestartPhase | null>(() => tracked.value[SELF_SERVICE_ID]?.phase ?? null);
    /** Requests before the household re-login would be read by a server that does not know us yet. */
    const online = computed(() => connection.isOpen && auth.isAuthed);

    watch(
        () => admin.session,
        (session) => {
            if (session === null && admin.busy !== 'set' && admin.busy !== 'unlock') reset();
        },
    );

    watch(
        () => connection.isOpen,
        (open) => {
            const self = tracked.value[SELF_SERVICE_ID];
            if (!open && self !== undefined && self.phase !== 'sending') self.phase = 'reconnecting';
        },
    );

    watch(online, (now) => {
        if (now && restarting.value) schedulePoll(0);
    });

    async function load(): Promise<ServiceState[] | null> {
        listSeq += 1;
        const seq = listSeq;
        const outcome = await admin.relay('services_list', undefined, false, isPanelError);
        if (seq !== listSeq) return services.value;
        if (outcome.ok) {
            services.value = toServices(outcome.data.result);
            error.value = null;
            settle(services.value);
            return services.value;
        }
        // The connection banner already says so; the last list stays readable.
        if (outcome.error.code === 'disconnected') return null;
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
        const outcome = await admin.relay('services_restart', servicesRestartParams(id), true, isPanelError);
        if (outcome.ok) {
            return { outcome: self ? 'self_restarting' : 'restarting', error: null };
        }
        // A reply still held (the daemon's guard can wait out a version check)
        // or lost to the kill: the restart may run anyway, so the list decides.
        if (outcome.error.code === 'timeout') {
            return { outcome: self ? 'self_restarting' : 'restarting', error: null };
        }
        if (self && outcome.error.code === 'disconnected' && isSelfRestartDrop()) {
            return { outcome: 'self_restarting', error: null };
        }
        if (self) selfRestartAt.value = null;
        return { outcome: 'failed', error: outcome.error };
    }

    /** Restarts `id` and follows it until the list shows the new process, a failure, or the deadline. */
    async function restartAndWatch(id: string): Promise<void> {
        if (tracked.value[id] !== undefined) return;
        const entry = services.value?.find((s) => s.id === id);
        const self = id === SELF_SERVICE_ID;
        delete results.value[id];
        tracked.value[id] = {
            phase: 'sending',
            before: entry?.since ?? '',
            oneshot: entry?.kind === 'oneshot',
            deadline: 0,
        };
        const { error: failure } = await restart(id);
        const item = tracked.value[id];
        if (item === undefined) return;
        if (failure !== null) {
            delete tracked.value[id];
            results.value[id] = { status: 'error', error: failure };
            return;
        }
        item.phase = self && !connection.isOpen ? 'reconnecting' : 'waiting';
        item.deadline = Date.now() + (self ? SELF_RESTART_DEADLINE_MS : RESTART_DEADLINE_MS);
        schedulePoll(RESTART_POLL_MS);
    }

    function settle(list: ServiceState[]): void {
        const now = Date.now();
        for (const [id, item] of Object.entries(tracked.value)) {
            if (item.phase === 'sending') continue;
            const entry = list.find((s) => s.id === id);
            const changed = entry !== undefined && entry.since !== '' && entry.since !== item.before;
            const state = entry?.activeState;
            let result: RestartResult['status'] | null = null;
            if (entry === undefined || state === 'not-found') result = 'not_found';
            else if (state === 'failed') result = 'failed';
            // The first poll comes after the daemon's delayed `start`: a oneshot
            // that is not running any more has run.
            else if (item.oneshot && (state === 'inactive' || state === 'active')) result = 'done';
            else if (!item.oneshot && state === 'active' && changed) result = 'done';
            else if (now >= item.deadline) result = 'timeout';
            if (result === null) continue;
            delete tracked.value[id];
            results.value[id] = { status: result } as RestartResult;
            if (id === SELF_SERVICE_ID) selfRestartAt.value = null;
        }
    }

    function schedulePoll(delayMs: number): void {
        if (pollTimer !== null) clearTimeout(pollTimer);
        pollTimer = setTimeout(() => {
            pollTimer = null;
            void poll();
        }, delayMs);
    }

    async function poll(): Promise<void> {
        if (!restarting.value) return;
        if (online.value) {
            await load();
        } else {
            // Offline past the deadline still ends: the box may never come back on this address.
            if (services.value !== null) settle(services.value);
        }
        if (restarting.value) schedulePoll(RESTART_POLL_MS);
    }

    /** The socket just dropped because of our own calaos-server restart. */
    function isSelfRestartDrop(now = Date.now()): boolean {
        return selfRestartAt.value !== null && now - selfRestartAt.value < SELF_RESTART_DROP_MS;
    }

    function dismiss(id: string): void {
        delete results.value[id];
    }

    function reset(): void {
        listSeq += 1;
        if (pollTimer !== null) clearTimeout(pollTimer);
        pollTimer = null;
        services.value = null;
        error.value = null;
        selfRestartAt.value = null;
        tracked.value = {};
        results.value = {};
    }

    return {
        services,
        error,
        selfRestartAt,
        tracked,
        results,
        restarting,
        selfPhase,
        load,
        restart,
        restartAndWatch,
        isSelfRestartDrop,
        dismiss,
        reset,
    };
});
