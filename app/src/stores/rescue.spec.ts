import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from './auth';
import { useConnectionStore } from './connection';
import { RETRY_FAST_MS, RETRY_FAST_WINDOW_MS, RETRY_SLOW_MS, useRescueStore } from './rescue';
import { fail, flush, harness, last, ok, setUp, unlocked } from './adminTestHarness';

function goOnline(): void {
    useConnectionStore().applyStatus({ status: 'open', attempt: 0, nextRetryMs: 0 });
    useAuthStore().$patch({ state: 'authed' });
}

function goOffline(): void {
    useConnectionStore().applyStatus({ status: 'reconnecting', attempt: 1, nextRetryMs: 1000 });
}

beforeEach(async () => {
    setUp();
    await unlocked();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('rescue store', () => {
    it('reads without an admin session once online', async () => {
        const rescue = useRescueStore();
        expect(harness.sent).toHaveLength(0);
        goOnline();
        await flush();
        expect(last().data).toEqual({ action: 'rescue_status' });
        ok({ rescue: true, overlay: true, snapshot: 145 });
        await flush();
        expect(rescue.active).toBe(true);
        expect(rescue.snapshot).toBe(145);
    });

    it('reads again on every reconnection', async () => {
        const rescue = useRescueStore();
        goOnline();
        await flush();
        ok({ rescue: true, overlay: true, snapshot: 3 });
        await flush();
        goOffline();
        await flush();
        harness.sent = [];
        goOnline();
        await flush();
        expect(last().data.action).toBe('rescue_status');
        ok({ rescue: false, overlay: false, snapshot: null });
        await flush();
        expect(rescue.active).toBe(false);
    });

    it('retries at 5 s for two minutes, then every minute, without touching the admin gate', async () => {
        const rescue = useRescueStore();
        const { useAdminStore } = await import('./admin');
        goOnline();
        await flush();
        fail('admin_unavailable');
        await flush();
        expect(rescue.failed).toBe(true);
        expect(useAdminStore().gate).toBe('unlocked');

        harness.sent = [];
        vi.advanceTimersByTime(RETRY_FAST_MS);
        expect(harness.sent).toHaveLength(1);
        fail('admin_unavailable');
        await flush();

        vi.advanceTimersByTime(RETRY_FAST_WINDOW_MS);
        await flush();
        fail('admin_unavailable');
        await flush();

        harness.sent = [];
        vi.advanceTimersByTime(RETRY_FAST_MS);
        expect(harness.sent).toHaveLength(0);
        vi.advanceTimersByTime(RETRY_SLOW_MS - RETRY_FAST_MS);
        expect(harness.sent).toHaveLength(1);
        ok({ rescue: false, overlay: false, snapshot: null });
        await flush();
        expect(rescue.failed).toBe(false);
        harness.sent = [];
        vi.advanceTimersByTime(RETRY_SLOW_MS * 2);
        expect(harness.sent).toHaveLength(0);
    });

    it('forgets the status when the login is lost', async () => {
        const rescue = useRescueStore();
        goOnline();
        await flush();
        ok({ rescue: true, overlay: true, snapshot: 3 });
        await flush();
        useAuthStore().$patch({ state: 'idle' });
        await flush();
        expect(rescue.status).toBeNull();
        harness.sent = [];
        vi.advanceTimersByTime(RETRY_SLOW_MS);
        expect(harness.sent).toHaveLength(0);
    });
});
