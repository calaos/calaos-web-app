// The box's services: their state, and the verbs the daemon offers for each
// (calaos_base docs/08_http_api.md, "Services"). Session only.

import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import {
    CONNECTION_SERVICE_IDS,
    DAEMON_SERVICE_ID,
    RELOADED_SERVICE_IDS,
    SELF_SERVICE_ID,
    serviceParams,
    toServices,
} from '../protocol/admin-services';
import type { ServiceState, ServiceVerb } from '../protocol/admin-services';
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

export function serviceDeadlineMs(id: string): number {
    return id === SELF_SERVICE_ID ? SELF_RESTART_DEADLINE_MS : RESTART_DEADLINE_MS;
}

export type RestartOutcome = 'restarting' | 'self_restarting' | 'failed';

/** Where an action this client asked for stands. */
export type ServicePhase = 'sending' | 'waiting' | 'reconnecting';

export type ServiceResult =
    | { verb: ServiceVerb; status: 'done' | 'failed' | 'not_found' | 'timeout' }
    | { verb: ServiceVerb; status: 'error'; error: AdminError };

function dropsConnection(id: string, verb: ServiceVerb): boolean {
    return verb === 'restart' && CONNECTION_SERVICE_IDS.includes(id);
}

/**
 * `start` can still be queued behind a dependency, so `inactive` is no answer
 * yet; only `active` is. A `failed` that gets here predates the verb, and
 * stopping such a unit leaves it `failed` until a `reset-failed`.
 */
function reached(entry: ServiceState, verb: ServiceVerb, before: string): boolean {
    const state = entry.activeState;
    switch (verb) {
        case 'restart':
            if (state !== 'active') return false;
            return RELOADED_SERVICE_IDS.includes(entry.id) || (entry.since !== '' && entry.since !== before);
        case 'start':
            return state === 'active';
        case 'stop':
            return state === 'inactive' || state === 'failed';
        case 'enable':
            return state === 'active' && entry.startup === 'enabled';
        case 'disable':
            return (state === 'inactive' || state === 'failed') && entry.startup === 'disabled';
    }
}

interface Tracked {
    phase: ServicePhase;
    verb: ServiceVerb;
    /** `since` before the request: `active` alone may be the old process, not the restarted one. */
    before: string;
    /** The row was `failed` when asked and no list has shown it move: that is not this verb failing. */
    stillFailed: boolean;
    deadline: number;
}

export const useAdminServicesStore = defineStore('adminServices', () => {
    const admin = useAdminStore();
    const auth = useAuthStore();
    const connection = useConnectionStore();

    /** null until read. */
    const services = ref<ServiceState[] | null>(null);
    const error = ref<AdminError | null>(null);
    /** When a service carrying our socket was last asked to restart (ms epoch), for the drop that follows. */
    const selfRestartAt = ref<number | null>(null);
    const tracked = ref<Record<string, Tracked>>({});
    const results = ref<Record<string, ServiceResult>>({});

    let listSeq = 0;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const working = computed(() => Object.keys(tracked.value).length > 0);
    /** The service whose restart is taking this page's connection down. */
    const selfId = computed(
        () => CONNECTION_SERVICE_IDS.find((id) => tracked.value[id]?.verb === 'restart') ?? null,
    );
    const selfPhase = computed<ServicePhase | null>(() =>
        selfId.value === null ? null : tracked.value[selfId.value].phase,
    );
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
            const self = selfId.value === null ? undefined : tracked.value[selfId.value];
            if (!open && self !== undefined && self.phase !== 'sending') self.phase = 'reconnecting';
        },
    );

    watch(online, (now) => {
        if (now && working.value) schedulePoll(0);
    });

    /** Our own restart of the daemon must not read as a dead box: the polls just wait for it. */
    function isLocalListError(failure: AdminError): boolean {
        if (isPanelError(failure)) return true;
        const daemonRestarting = tracked.value[DAEMON_SERVICE_ID] !== undefined;
        return daemonRestarting && (failure.code === 'daemon_unreachable' || failure.code === 'admin_unavailable');
    }

    async function load(): Promise<ServiceState[] | null> {
        listSeq += 1;
        const seq = listSeq;
        const outcome = await admin.relay('services_list', undefined, false, isLocalListError);
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
     * Sends a verb. The answer says nothing of the outcome: the caller polls
     * `load()`. Restarting calaos-server or haproxy cuts this very connection,
     * which is the restart working.
     */
    async function act(id: string, verb: ServiceVerb): Promise<{ outcome: RestartOutcome; error: AdminError | null }> {
        const self = dropsConnection(id, verb);
        if (self) selfRestartAt.value = Date.now();
        const outcome = await admin.relay(`services_${verb}`, serviceParams(id), true, isPanelError);
        if (outcome.ok) {
            return { outcome: self ? 'self_restarting' : 'restarting', error: null };
        }
        // A reply still held (the daemon's guard can wait out a version check)
        // or lost to the kill: the action may run anyway, so the list decides.
        if (outcome.error.code === 'timeout') {
            return { outcome: self ? 'self_restarting' : 'restarting', error: null };
        }
        if (self && outcome.error.code === 'disconnected' && isSelfRestartDrop()) {
            return { outcome: 'self_restarting', error: null };
        }
        if (self) selfRestartAt.value = null;
        return { outcome: 'failed', error: outcome.error };
    }

    function restart(id: string): ReturnType<typeof act> {
        return act(id, 'restart');
    }

    /** Runs `verb` on `id` and follows it until the list shows the outcome, a failure, or the deadline. */
    async function actAndWatch(id: string, verb: ServiceVerb): Promise<void> {
        if (tracked.value[id] !== undefined) return;
        const entry = services.value?.find((s) => s.id === id);
        delete results.value[id];
        tracked.value[id] = {
            phase: 'sending',
            verb,
            before: entry?.since ?? '',
            stillFailed: entry?.activeState === 'failed',
            deadline: 0,
        };
        const { error: failure } = await act(id, verb);
        const item = tracked.value[id];
        if (item === undefined) return;
        if (failure !== null) {
            delete tracked.value[id];
            results.value[id] = { verb, status: 'error', error: failure };
            // The row was stale: the list shows what the box really has.
            if (failure.code === 'service_unavailable') await load();
            return;
        }
        item.phase = dropsConnection(id, verb) && !connection.isOpen ? 'reconnecting' : 'waiting';
        item.deadline = Date.now() + serviceDeadlineMs(id);
        schedulePoll(RESTART_POLL_MS);
    }

    function settle(list: ServiceState[]): void {
        const now = Date.now();
        for (const [id, item] of Object.entries(tracked.value)) {
            if (item.phase === 'sending') continue;
            const entry = list.find((s) => s.id === id);
            if (item.stillFailed && (entry?.activeState !== 'failed' || entry.since !== item.before)) {
                item.stillFailed = false;
            }
            let status: 'done' | 'failed' | 'not_found' | 'timeout' | null = null;
            if (entry === undefined || entry.activeState === 'not-found') status = 'not_found';
            else if (entry.activeState === 'failed' && !item.stillFailed) status = 'failed';
            else if (reached(entry, item.verb, item.before)) status = 'done';
            else if (now >= item.deadline) status = 'timeout';
            if (status !== null) finish(id, item, status);
        }
    }

    /** No list to judge by: only the deadline can still end the wait. */
    function expire(): void {
        const now = Date.now();
        for (const [id, item] of Object.entries(tracked.value)) {
            if (item.phase !== 'sending' && now >= item.deadline) finish(id, item, 'timeout');
        }
    }

    function finish(id: string, item: Tracked, status: 'done' | 'failed' | 'not_found' | 'timeout'): void {
        delete tracked.value[id];
        results.value[id] = { verb: item.verb, status };
        if (dropsConnection(id, item.verb)) selfRestartAt.value = null;
    }

    function schedulePoll(delayMs: number): void {
        if (pollTimer !== null) clearTimeout(pollTimer);
        pollTimer = setTimeout(() => {
            pollTimer = null;
            void poll();
        }, delayMs);
    }

    async function poll(): Promise<void> {
        if (!working.value) return;
        // The last list predates the verb, and the box may never come back on this address.
        const list = online.value ? await load() : null;
        if (list === null) expire();
        if (working.value) schedulePoll(RESTART_POLL_MS);
    }

    /** The socket just dropped because of our own restart of what carries it. */
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
        working,
        selfId,
        selfPhase,
        load,
        restart,
        actAndWatch,
        isSelfRestartDrop,
        dismiss,
        reset,
    };
});
