// The box's journal, read page by page (calaos_base docs/08_http_api.md,
// "Logs"). One query in flight at a time; "load older" goes backward from
// the oldest cursor held, "follow" repeats a forward query from the newest
// one every 2 s. The daemon keeps no state: the cursors are all here.

import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { LOG_FOLLOW_INTERVAL_MS, logQueryParams, toLogPage, toLogSources } from '../protocol/admin-logs';
import type { LogEntry, LogPage, LogQuery, LogSource } from '../protocol/admin-logs';
import type { AdminError } from '../protocol/admin';
import { toTimeParam } from '../protocol/admin-time';
import { useAdminStore } from './admin';

/** Rows kept in memory; the oldest go first while following. */
export const LOG_ROWS_MAX = 5_000;

/** What the filter bar sets; cursors and direction are the store's. */
export type LogFilter = Omit<LogQuery, 'cursor' | 'direction'>;

/** A cursor query keeps the filter but not `until` (and, forward, not `since`). */
function withoutBounds(filter: LogFilter, dropSince: boolean): LogFilter {
    const copy = { ...filter };
    delete copy.until;
    if (dropSince) delete copy.since;
    return copy;
}

export const useAdminLogsStore = defineStore('adminLogs', () => {
    const admin = useAdminStore();

    /** null until read. */
    const sources = ref<LogSource[] | null>(null);
    const entries = ref<LogEntry[]>([]);
    const filter = ref<LogFilter>({});
    const error = ref<AdminError | null>(null);
    const loading = ref(false);
    const following = ref(false);
    /** The last query's scan ended before enough matches (a success). */
    const incomplete = ref(false);
    /** The 1 MiB budget cut an answer. */
    const truncated = ref(false);
    /** Nothing older to scan. */
    const olderExhausted = ref(false);
    /** "Load older" stopped at the row cap. */
    const capped = ref(false);

    let olderCursor: string | null = null;
    let newerCursor: string | null = null;
    /** For a follow that starts from an empty result: forward needs a cursor or a `since`. */
    let followSince = '';
    let followTimer: ReturnType<typeof setTimeout> | null = null;
    let generation = 0;

    const hasEntries = computed(() => entries.value.length > 0);

    watch(
        () => admin.session,
        (session) => {
            if (session === null && admin.busy !== 'set' && admin.busy !== 'unlock') reset();
        },
    );

    async function loadSources(): Promise<void> {
        const outcome = await admin.relay('logs_sources', undefined, false);
        if (outcome.ok) sources.value = toLogSources(outcome.data.result);
        else if (admin.gate === 'unlocked') error.value = outcome.error;
    }

    /** One query; no page when it failed, was superseded, or another is out. */
    async function query(params: LogQuery): Promise<{ page: LogPage | null; failure: AdminError | null }> {
        if (loading.value) return { page: null, failure: null };
        const gen = generation;
        loading.value = true;
        const outcome = await admin.relay('logs_query', logQueryParams(params), false);
        if (gen !== generation) return { page: null, failure: null };
        loading.value = false;
        if (!outcome.ok) {
            if (admin.gate === 'unlocked') error.value = outcome.error;
            return { page: null, failure: outcome.error };
        }
        error.value = null;
        const page = toLogPage(outcome.data.result);
        incomplete.value = !page.complete;
        truncated.value = page.truncated;
        return { page, failure: null };
    }

    /** A fresh read of the newest entries matching `next`. */
    async function search(next: LogFilter): Promise<boolean> {
        generation += 1;
        loading.value = false;
        filter.value = { ...next };
        entries.value = [];
        olderCursor = null;
        newerCursor = null;
        olderExhausted.value = false;
        capped.value = false;
        followSince = toTimeParam(Date.now());
        const { page } = await query({ ...filter.value, direction: 'backward' });
        if (page === null) return false;
        entries.value = page.entries.slice(-LOG_ROWS_MAX);
        olderCursor = page.nextCursor;
        olderExhausted.value = page.nextCursor === null;
        newerCursor = page.entries.at(-1)?.cursor ?? null;
        return true;
    }

    async function loadOlder(): Promise<boolean> {
        if (olderCursor === null || capped.value) return false;
        const { page } = await query({ ...withoutBounds(filter.value, false), cursor: olderCursor, direction: 'backward' });
        if (page === null) return false;
        const room = LOG_ROWS_MAX - entries.value.length;
        const kept = room >= page.entries.length ? page.entries : page.entries.slice(page.entries.length - Math.max(0, room));
        if (kept.length < page.entries.length) capped.value = true;
        entries.value = [...kept, ...entries.value];
        if (page.nextCursor === null) olderExhausted.value = true;
        else olderCursor = page.nextCursor;
        return true;
    }

    /** One forward read from the newest cursor; the oldest rows go past the cap. */
    async function loadNewer(): Promise<{ ok: boolean; retryAfterMs: number }> {
        const since = filter.value.since;
        const from: LogQuery =
            newerCursor !== null ? { cursor: newerCursor } : { since: since !== undefined && since !== '' ? since : followSince };
        const { page, failure } = await query({ ...withoutBounds(filter.value, true), ...from, direction: 'forward' });
        if (page === null) {
            const retry = failure?.code === 'rate_limited' ? (failure.retryAfter ?? 1) * 1000 : 0;
            return { ok: false, retryAfterMs: retry };
        }
        if (page.entries.length > 0) {
            const merged = [...entries.value, ...page.entries];
            entries.value = merged.length > LOG_ROWS_MAX ? merged.slice(merged.length - LOG_ROWS_MAX) : merged;
        }
        if (page.nextCursor !== null) newerCursor = page.nextCursor;
        return { ok: true, retryAfterMs: 0 };
    }

    function scheduleFollow(delayMs: number): void {
        if (followTimer !== null) clearTimeout(followTimer);
        followTimer = setTimeout(() => {
            followTimer = null;
            void followTick();
        }, delayMs);
    }

    async function followTick(): Promise<void> {
        if (!following.value) return;
        if (admin.gate !== 'unlocked') {
            stopFollow();
            return;
        }
        const { retryAfterMs } = await loadNewer();
        if (!following.value) return;
        // A drop or a slow box: keep the cadence; the next tick lands once the
        // socket is back and signed in (the session survives a reconnect).
        scheduleFollow(Math.max(LOG_FOLLOW_INTERVAL_MS, retryAfterMs));
    }

    function startFollow(): void {
        if (following.value) return;
        following.value = true;
        scheduleFollow(0);
    }

    function stopFollow(): void {
        following.value = false;
        if (followTimer !== null) clearTimeout(followTimer);
        followTimer = null;
    }

    function reset(): void {
        stopFollow();
        generation += 1;
        sources.value = null;
        entries.value = [];
        filter.value = {};
        error.value = null;
        loading.value = false;
        incomplete.value = false;
        truncated.value = false;
        olderExhausted.value = false;
        capped.value = false;
        olderCursor = null;
        newerCursor = null;
        followSince = '';
    }

    return {
        sources,
        entries,
        filter,
        error,
        loading,
        following,
        incomplete,
        truncated,
        olderExhausted,
        capped,
        hasEntries,
        loadSources,
        search,
        loadOlder,
        loadNewer,
        startFollow,
        stopFollow,
        reset,
    };
});
