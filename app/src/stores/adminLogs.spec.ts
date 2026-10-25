import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminStore } from './admin';
import { LOG_ROWS_MAX, useAdminLogsStore } from './adminLogs';
import { fail, flush, harness, last, ok, setUp, unlocked } from './adminTestHarness';

beforeEach(setUp);

afterEach(() => {
    vi.useRealTimers();
});

describe('logs store', () => {
    const entry = (n: number) => ({ cursor: `c${n}`, ts: `2026-10-25T09:00:${String(n).padStart(2, '0')}.000Z`, source: 'kernel', unit: 'kernel', priority: 6, message: `m${n}` });

    it('searches backward, loads older from the oldest cursor, follows from the newest', async () => {
        await unlocked();
        const logs = useAdminLogsStore();
        void logs.search({ sources: ['kernel'], priority: 'warning' });
        expect(last().data.params).toEqual({ sources: ['kernel'], priority: 'warning', direction: 'backward' });
        ok({ entries: [entry(10), entry(11)], truncated: false, complete: false, next_cursor: 'c10' });
        await flush();
        expect(logs.entries.map((e) => e.cursor)).toEqual(['c10', 'c11']);
        expect(logs.incomplete).toBe(true);

        void logs.loadOlder();
        expect(last().data.params).toEqual({ sources: ['kernel'], priority: 'warning', cursor: 'c10', direction: 'backward' });
        ok({ entries: [entry(8), entry(9)], truncated: false, complete: true, next_cursor: 'c8' });
        await flush();
        expect(logs.entries.map((e) => e.cursor)).toEqual(['c8', 'c9', 'c10', 'c11']);
        // Complete with fewer than asked: the start of the range.
        expect(logs.olderExhausted).toBe(true);
        expect(logs.incomplete).toBe(false);

        logs.startFollow();
        vi.advanceTimersByTime(0);
        expect(last().data.params).toEqual({ sources: ['kernel'], priority: 'warning', cursor: 'c11', direction: 'forward' });
        ok({ entries: [entry(12)], truncated: false, complete: true, next_cursor: 'c12' });
        await flush();
        expect(logs.entries.at(-1)?.cursor).toBe('c12');
        harness.sent = [];
        vi.advanceTimersByTime(1_999);
        expect(harness.sent).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(last().data.params).toMatchObject({ cursor: 'c12', direction: 'forward' });
        logs.stopFollow();
    });

    it('backs off for retry_after when rate-limited while following', async () => {
        await unlocked();
        const logs = useAdminLogsStore();
        void logs.search({});
        ok({ entries: [entry(1)], truncated: false, complete: true, next_cursor: 'c1' });
        await flush();
        logs.startFollow();
        vi.advanceTimersByTime(0);
        fail('rate_limited', { retry_after: '5' });
        await flush();
        expect(logs.error?.code).toBe('rate_limited');
        harness.sent = [];
        vi.advanceTimersByTime(4_999);
        expect(harness.sent).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(harness.sent).toHaveLength(1);
        logs.stopFollow();
    });

    it('gives logs_query 12 s before calling it a timeout', async () => {
        await unlocked();
        const logs = useAdminLogsStore();
        void logs.search({});
        vi.advanceTimersByTime(11_000);
        expect(logs.loading).toBe(true);
        vi.advanceTimersByTime(1_000);
        await flush();
        expect(logs.loading).toBe(false);
    });

    const page = (entries: unknown[], extra: Record<string, unknown> = {}) => ({
        entries,
        truncated: false,
        complete: true,
        next_cursor: (entries.at(-1) as { cursor: string } | undefined)?.cursor ?? null,
        ...extra,
    });

    it('drops every cursor on a new search', async () => {
        await unlocked();
        const logs = useAdminLogsStore();
        void logs.search({ sources: ['kernel'] });
        ok(page([entry(5)], { complete: false, next_cursor: 'c5' }));
        await flush();
        void logs.search({ sources: ['ssh'] });
        expect(last().data.params).toEqual({ sources: ['ssh'], direction: 'backward' });
        ok(page([], { complete: false, next_cursor: 'c1' }));
        await flush();
        void logs.loadOlder();
        expect(last().data.params).toEqual({ sources: ['ssh'], cursor: 'c1', direction: 'backward' });
    });

    it('keeps going past an empty incomplete scan, and stops at a truncated page only when told', async () => {
        await unlocked();
        const logs = useAdminLogsStore();
        void logs.search({});
        ok(page([], { complete: false, next_cursor: 'c900' }));
        await flush();
        expect(logs.canLoadOlder).toBe(true);
        expect(logs.incomplete).toBe(true);
        void logs.loadOlder();
        ok(page([entry(3)], { truncated: true, next_cursor: 'c3' }));
        await flush();
        expect(logs.truncated).toBe(true);
        expect(logs.olderExhausted).toBe(false);
        void logs.loadOlder();
        expect(last().data.params).toMatchObject({ cursor: 'c3', direction: 'backward' });
        ok(page([], { next_cursor: null }));
        await flush();
        expect(logs.olderExhausted).toBe(true);
    });

    it('follows from the time of the search when it found nothing', async () => {
        await unlocked();
        vi.setSystemTime(new Date('2026-10-25T10:00:00Z'));
        const logs = useAdminLogsStore();
        void logs.search({ since: '2026-10-24T10:00:00Z' });
        ok(page([], { next_cursor: null }));
        await flush();
        logs.startFollow();
        vi.advanceTimersByTime(0);
        expect(last().data.params).toEqual({ since: '2026-10-25T10:00:00Z', direction: 'forward' });
        logs.stopFollow();
    });

    it('doubles the wait on refusals in a row, and catches up faster when behind', async () => {
        await unlocked();
        const logs = useAdminLogsStore();
        void logs.search({});
        ok(page([entry(1)], { complete: false }));
        await flush();
        logs.startFollow();
        vi.advanceTimersByTime(0);
        fail('rate_limited', { retry_after: '1' });
        await flush();
        expect(logs.backoffMs).toBe(2_000);
        vi.advanceTimersByTime(2_000);
        fail('rate_limited', { retry_after: '1' });
        await flush();
        expect(logs.backoffMs).toBe(4_000);
        harness.sent = [];
        vi.advanceTimersByTime(3_999);
        expect(harness.sent).toEqual([]);
        vi.advanceTimersByTime(1);
        // A page that did not reach the present: the next read comes after 1 s.
        ok(page([entry(2)], { complete: false }));
        await flush();
        expect(logs.backoffMs).toBe(0);
        harness.sent = [];
        vi.advanceTimersByTime(1_000);
        expect(harness.sent).toHaveLength(1);
        ok(page([], { next_cursor: 'c3' }));
        await flush();
        harness.sent = [];
        vi.advanceTimersByTime(1_999);
        expect(harness.sent).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(last().data.params).toMatchObject({ cursor: 'c3', direction: 'forward' });
        logs.stopFollow();
    });

    it('resumes "load older" right before the first row kept once follow passes the cap', async () => {
        await unlocked();
        const logs = useAdminLogsStore();
        void logs.search({});
        ok(page([entry(1)], { complete: false, next_cursor: 'c0' }));
        await flush();
        logs.startFollow();
        vi.advanceTimersByTime(0);
        const many = Array.from({ length: LOG_ROWS_MAX }, (_, i) => ({ ...entry(2), cursor: `n${i}` }));
        ok(page(many, { complete: true }));
        await flush();
        expect(logs.entries).toHaveLength(LOG_ROWS_MAX);
        expect(logs.entries[0].cursor).toBe('n0');
        logs.stopFollow();
        void logs.loadOlder();
        expect(last().data.params).toMatchObject({ cursor: 'n0', direction: 'backward' });
    });

    it('waits out a rate_limited search instead of failing it', async () => {
        await unlocked();
        const logs = useAdminLogsStore();
        let done: boolean | null = null;
        void logs.search({ sources: ['ssh'] }).then((ok) => (done = ok));
        fail('rate_limited', { retry_after: '1' });
        await flush();
        expect(logs.error).toBeNull();
        expect(logs.waiting).toBe(true);
        harness.sent = [];
        vi.advanceTimersByTime(999);
        expect(harness.sent).toEqual([]);
        vi.advanceTimersByTime(1);
        await flush();
        expect(last().data.params).toEqual({ sources: ['ssh'], direction: 'backward' });
        ok(page([entry(1)]));
        await flush();
        expect(done).toBe(true);
        expect(logs.entries).toHaveLength(1);
    });

    it('"load older" during a follow read waits for it, then is sent', async () => {
        await unlocked();
        const logs = useAdminLogsStore();
        void logs.search({});
        ok(page([entry(5)], { complete: false, next_cursor: 'c4' }));
        await flush();
        logs.startFollow();
        vi.advanceTimersByTime(0);
        expect(last().data.params).toMatchObject({ cursor: 'c5', direction: 'forward' });
        let done: boolean | null = null;
        void logs.loadOlder().then((loaded) => (done = loaded));
        await flush();
        expect(last().data.params).toMatchObject({ direction: 'forward' });
        ok(page([entry(6)]));
        await flush();
        expect(last().data.params).toMatchObject({ cursor: 'c4', direction: 'backward' });
        // Follow stands aside while the user's read is out.
        const sent = harness.sent.length;
        vi.advanceTimersByTime(2_000);
        expect(harness.sent).toHaveLength(sent);
        ok(page([entry(3)], { complete: false, next_cursor: 'c3' }));
        await flush();
        expect(done).toBe(true);
        expect(logs.entries.map((e) => e.cursor)).toEqual(['c3', 'c5', 'c6']);
        logs.stopFollow();
    });

    it('a rate-limited search is not lost to a follow tick during its wait', async () => {
        await unlocked();
        const logs = useAdminLogsStore();
        void logs.search({});
        ok(page([entry(1)], { complete: false }));
        await flush();
        logs.startFollow();
        vi.advanceTimersByTime(0);
        ok(page([], { next_cursor: 'c2' }));
        await flush();
        let done: boolean | null = null;
        void logs.search({ sources: ['kernel'] }).then((found) => (done = found));
        fail('rate_limited', { retry_after: '3' });
        await flush();
        harness.sent = [];
        // The follow tick (at 2 s) falls inside the wait: it does not read.
        vi.advanceTimersByTime(2_999);
        expect(harness.sent).toEqual([]);
        vi.advanceTimersByTime(1);
        await flush();
        expect(harness.sent).toHaveLength(1);
        expect(last().data.params).toEqual({ sources: ['kernel'], direction: 'backward' });
        ok(page([entry(7)], { complete: false, next_cursor: 'c6' }));
        await flush();
        expect(done).toBe(true);
        expect(logs.entries.map((e) => e.cursor)).toEqual(['c7']);
        void logs.loadOlder();
        expect(last().data.params).toMatchObject({ cursor: 'c6', direction: 'backward' });
        logs.stopFollow();
    });

    it('an older daemon stays in the view: the Admin page stays unlocked', async () => {
        await unlocked();
        const logs = useAdminLogsStore();
        void logs.loadSources();
        fail('daemon_too_old');
        await flush();
        expect(useAdminStore().gate).toBe('unlocked');
        expect(logs.error?.code).toBe('daemon_too_old');
        void logs.search({ sources: ['system'] });
        fail('daemon_too_old');
        await flush();
        expect(useAdminStore().gate).toBe('unlocked');
        expect(logs.error?.code).toBe('daemon_too_old');
    });
});
