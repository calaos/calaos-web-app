import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminLogsStore } from './adminLogs';
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
        ok({ entries: [entry(10), entry(11)], truncated: false, complete: true, next_cursor: 'c10' });
        await flush();
        expect(logs.entries.map((e) => e.cursor)).toEqual(['c10', 'c11']);

        void logs.loadOlder();
        expect(last().data.params).toEqual({ sources: ['kernel'], priority: 'warning', cursor: 'c10', direction: 'backward' });
        ok({ entries: [entry(8), entry(9)], truncated: false, complete: true, next_cursor: 'c8' });
        await flush();
        expect(logs.entries.map((e) => e.cursor)).toEqual(['c8', 'c9', 'c10', 'c11']);

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
});
