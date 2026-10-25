// The box's journal, read page by page (calaos_base docs/08_http_api.md,
// "Logs"). One query in flight at a time; "load older" goes backward from
// the oldest cursor held, "follow" repeats a forward query from the newest
// one every 2 s. The daemon keeps no state: the cursors are all here, and a
// cursor only continues the query it came from, so a new filter drops them.

import { computed, ref, shallowRef, watch } from 'vue';
import { defineStore } from 'pinia';
import { LOG_FOLLOW_INTERVAL_MS, LOG_LINES_DEFAULT, logQueryParams, toLogPage, toLogSources } from '../protocol/admin-logs';
import type { LogEntry, LogPage, LogQuery, LogSource } from '../protocol/admin-logs';
import type { AdminError } from '../protocol/admin';
import { toTimeParam } from '../protocol/admin-time';
import { useAdminStore } from './admin';

/** Rows kept in memory; the oldest go first while following. */
export const LOG_ROWS_MAX = 5_000;
/** The longest wait between two follow reads once the box keeps refusing. */
export const LOG_FOLLOW_BACKOFF_MAX_MS = 30_000;
/** A forward page that did not reach the present: read the rest sooner (2/s allowed). */
export const LOG_FOLLOW_CATCH_UP_MS = 1_000;
/** A search or "load older" refused for the rate is tried again this many times. */
export const LOG_USER_RETRIES = 3;

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
    // Replaced whole on every page: thousands of rows need no deep proxies.
    const entries = shallowRef<LogEntry[]>([]);
    const filter = ref<LogFilter>({});
    const error = ref<AdminError | null>(null);
    const loading = ref(false);
    /** A search or "load older" waits out a `rate_limited` before trying again. */
    const waiting = ref(false);
    const following = ref(false);
    /** The last backward scan ended before enough matches (a success). */
    const incomplete = ref(false);
    /** The 1 MiB budget cut the last backward answer. */
    const truncated = ref(false);
    /** Nothing older to scan. */
    const olderExhausted = ref(false);
    /** "Load older" stopped at the row cap. */
    const capped = ref(false);
    /** The next follow read waits this long because the box asked to (0: normal cadence). */
    const backoffMs = ref(0);

    let olderCursor: string | null = null;
    let newerCursor: string | null = null;
    /** For a follow that starts from an empty result: forward needs a cursor or a `since`. */
    let followSince = '';
    let followTimer: ReturnType<typeof setTimeout> | null = null;
    let refusals = 0;
    let generation = 0;

    const hasEntries = computed(() => entries.value.length > 0);
    const canLoadOlder = computed(() => !olderExhausted.value && !capped.value);

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
        return { page: toLogPage(outcome.data.result), failure: null };
    }

    /**
     * A query the user asked for. Changing filters quickly easily goes past
     * the box's 2 per second: wait as told rather than show an error.
     */
    async function userQuery(params: LogQuery): Promise<{ page: LogPage | null; failure: AdminError | null }> {
        const gen = generation;
        for (let attempt = 0; ; attempt += 1) {
            const result = await query(params);
            const retryAfter = result.failure?.code === 'rate_limited' ? (result.failure.retryAfter ?? 1) : 0;
            if (retryAfter <= 0 || attempt >= LOG_USER_RETRIES || gen !== generation) return result;
            error.value = null;
            waiting.value = true;
            await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
            waiting.value = false;
            if (gen !== generation) return { page: null, failure: null };
        }
    }

    /**
     * A complete backward page with fewer matches than asked reached the
     * start of the range: one more read would only come back empty.
     */
    function noteBackward(page: LogPage, lines: number): void {
        incomplete.value = !page.complete;
        truncated.value = page.truncated;
        if (page.nextCursor === null || (page.complete && !page.truncated && page.entries.length < lines)) {
            olderExhausted.value = true;
        }
        if (page.nextCursor !== null) olderCursor = page.nextCursor;
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
        incomplete.value = false;
        truncated.value = false;
        followSince = toTimeParam(Date.now());
        const { page } = await userQuery({ ...filter.value, direction: 'backward' });
        if (page === null) return false;
        entries.value = page.entries.slice(-LOG_ROWS_MAX);
        noteBackward(page, filter.value.lines ?? LOG_LINES_DEFAULT);
        newerCursor = page.entries.at(-1)?.cursor ?? null;
        return true;
    }

    async function loadOlder(): Promise<boolean> {
        if (olderCursor === null || !canLoadOlder.value) return false;
        const { page } = await userQuery({ ...withoutBounds(filter.value, false), cursor: olderCursor, direction: 'backward' });
        if (page === null) return false;
        const room = Math.max(0, LOG_ROWS_MAX - entries.value.length);
        const kept = room >= page.entries.length ? page.entries : page.entries.slice(page.entries.length - room);
        entries.value = [...kept, ...entries.value];
        noteBackward(page, filter.value.lines ?? LOG_LINES_DEFAULT);
        if (kept.length < page.entries.length) {
            capped.value = true;
            // What did not fit is still older than the first row kept.
            olderCursor = kept[0]?.cursor ?? olderCursor;
        }
        return true;
    }

    /** One forward read from the newest cursor; the oldest rows go past the cap. */
    async function loadNewer(): Promise<{ ok: boolean; retryAfterMs: number; behind: boolean }> {
        // Without a row yet, from the search itself: the filter's `since` lies
        // behind what the search already scanned backward.
        const from: LogQuery = newerCursor !== null ? { cursor: newerCursor } : { since: followSince };
        const { page, failure } = await query({ ...withoutBounds(filter.value, true), ...from, direction: 'forward' });
        if (page === null) {
            const retry = failure?.code === 'rate_limited' ? (failure.retryAfter ?? 1) * 1000 : 0;
            return { ok: false, retryAfterMs: retry, behind: false };
        }
        if (page.entries.length > 0) {
            const merged = [...entries.value, ...page.entries];
            if (merged.length > LOG_ROWS_MAX) {
                const dropped = merged.length - LOG_ROWS_MAX;
                entries.value = merged.slice(dropped);
                // "Load older" must resume right before the first row still
                // shown, or the rows dropped here would leave a hole.
                olderCursor = entries.value[0].cursor;
                olderExhausted.value = false;
                capped.value = false;
            } else {
                entries.value = merged;
            }
        }
        if (page.nextCursor !== null) newerCursor = page.nextCursor;
        const lines = filter.value.lines ?? LOG_LINES_DEFAULT;
        return { ok: true, retryAfterMs: 0, behind: !page.complete || page.truncated || page.entries.length >= lines };
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
        const { ok, retryAfterMs, behind } = await loadNewer();
        if (!following.value) return;
        if (retryAfterMs > 0) {
            // Doubling on each refusal in a row: other tabs or the CLI share the box's budget.
            refusals += 1;
            const wait = Math.max(LOG_FOLLOW_INTERVAL_MS, retryAfterMs) * 2 ** Math.min(refusals - 1, 4);
            backoffMs.value = Math.min(LOG_FOLLOW_BACKOFF_MAX_MS, wait);
            scheduleFollow(backoffMs.value);
            return;
        }
        refusals = 0;
        backoffMs.value = 0;
        // A drop or a slow box keeps the cadence; the next tick lands once the
        // socket is back and signed in (the session survives a reconnect).
        scheduleFollow(ok && behind ? LOG_FOLLOW_CATCH_UP_MS : LOG_FOLLOW_INTERVAL_MS);
    }

    function startFollow(): void {
        if (following.value) return;
        following.value = true;
        refusals = 0;
        backoffMs.value = 0;
        scheduleFollow(0);
    }

    function stopFollow(): void {
        following.value = false;
        backoffMs.value = 0;
        refusals = 0;
        if (followTimer !== null) clearTimeout(followTimer);
        followTimer = null;
    }

    function dismissError(): void {
        error.value = null;
    }

    function reset(): void {
        stopFollow();
        generation += 1;
        sources.value = null;
        entries.value = [];
        filter.value = {};
        error.value = null;
        loading.value = false;
        waiting.value = false;
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
        waiting,
        following,
        incomplete,
        truncated,
        olderExhausted,
        capped,
        backoffMs,
        hasEntries,
        canLoadOlder,
        loadSources,
        search,
        loadOlder,
        loadNewer,
        startFollow,
        stopFollow,
        dismissError,
        reset,
    };
});
