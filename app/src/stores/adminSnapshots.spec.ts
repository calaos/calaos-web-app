import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminStore } from './admin';
import { useAuthStore } from './auth';
import { useConnectionStore } from './connection';
import { REBOOT_DEADLINE_MS, useAdminSnapshotsStore } from './adminSnapshots';
import { useRescueStore } from './rescue';
import { SESSION, fail, flush, harness, last, ok, setUp, unlocked } from './adminTestHarness';

function open(): void {
    useConnectionStore().applyStatus({ status: 'open', attempt: 0, nextRetryMs: 0 });
}

function drop(): void {
    useConnectionStore().applyStatus({ status: 'reconnecting', attempt: 1, nextRetryMs: 1000 });
}

const LIST = {
    booted: { id: 1 },
    snapshots: [{ id: 1, bootable: true, current: true, default: true, date: '2026-11-01', description: 'first' }],
    apt_snapshots: true,
};

let snaps: ReturnType<typeof useAdminSnapshotsStore>;

beforeEach(async () => {
    setUp();
    await unlocked();
    useAuthStore().$patch({ state: 'authed' });
    open();
    snaps = useAdminSnapshotsStore();
    harness.sent = [];
});

afterEach(() => {
    vi.useRealTimers();
});

async function loaded(): Promise<void> {
    void snaps.load();
    expect(last().data).toEqual({ action: 'snapshots_list', admin_session: SESSION });
    ok(LIST);
    await flush();
}

describe('adminSnapshots store', () => {
    it('lists', async () => {
        await loaded();
        expect(snaps.list?.booted).toBe(1);
        expect(snaps.list?.snapshots).toHaveLength(1);
        expect(snaps.error).toBeNull();
    });

    it('keeps the gate open on admin_unavailable', async () => {
        void snaps.load();
        fail('admin_unavailable');
        await flush();
        expect(snaps.error?.code).toBe('admin_unavailable');
        expect(useAdminStore().gate).toBe('unlocked');
    });

    it('boots by id, then waits for the reboot', async () => {
        await loaded();
        void snaps.boot(1);
        expect(last().data).toMatchObject({ action: 'snapshot_boot', params: { id: 1 } });
        expect(snaps.phase).toBe('sending');
        ok(null);
        await flush();
        expect(snaps.phase).toBe('rebooting');
        expect(snaps.action).toBe('boot');
        expect(snaps.outcomeUnknown).toBe(false);
    });

    it('ignores a second action while one is running', async () => {
        void snaps.boot(1);
        const count = harness.sent.length;
        void snaps.boot(2);
        void snaps.rollback();
        expect(harness.sent).toHaveLength(count);
    });

    it('shows a refusal, reads the list again and does not reboot', async () => {
        void snaps.boot(9);
        fail('invalid_snapshot');
        await flush();
        expect(snaps.phase).toBe('idle');
        expect(snaps.actionError?.code).toBe('invalid_snapshot');
        expect(useAdminStore().gate).toBe('unlocked');
        expect(last().data.action).toBe('snapshots_list');
        snaps.dismissActionError();
        expect(snaps.actionError).toBeNull();
    });

    it('reads the rescue status again after in_rescue', async () => {
        void snaps.boot(2);
        fail('in_rescue');
        await flush();
        expect(harness.sent.some((f) => f.data.action === 'rescue_status')).toBe(true);
    });

    it('treats an unknown outcome as a reboot and never resends', async () => {
        void snaps.rollback();
        expect(last().data.action).toBe('snapshot_rollback');
        fail('daemon_unreachable', { outcome: 'unknown' });
        await flush();
        expect(snaps.phase).toBe('rebooting');
        expect(snaps.outcomeUnknown).toBe(true);
        expect(harness.sent.filter((f) => f.data.action === 'snapshot_rollback')).toHaveLength(1);
    });

    it('treats a timeout as a reboot', async () => {
        void snaps.boot(1);
        vi.advanceTimersByTime(60_000);
        await flush();
        expect(snaps.phase).toBe('rebooting');
        expect(snaps.outcomeUnknown).toBe(true);
    });

    it('ends the reboot when the connection returns after a drop, and reads again', async () => {
        void snaps.boot(1);
        ok(null);
        await flush();
        harness.sent = [];
        drop();
        await flush();
        expect(snaps.phase).toBe('rebooting');
        open();
        await flush();
        expect(snaps.phase).toBe('idle');
        const actions = harness.sent.map((f) => f.data.action);
        expect(actions).toContain('rescue_status');
        expect(actions).toContain('snapshots_list');
    });

    it('ends the reboot after the deadline when nothing dropped', async () => {
        void snaps.boot(1);
        ok(null);
        await flush();
        vi.advanceTimersByTime(REBOOT_DEADLINE_MS);
        await flush();
        expect(snaps.phase).toBe('idle');
    });

    it('returns to the normal system through the box reboot', async () => {
        const rescue = useRescueStore();
        void rescue;
        void snaps.returnNormal();
        expect(last().data.action).toBe('system_reboot');
        ok(null);
        await flush();
        expect(snaps.phase).toBe('rebooting');
        expect(snaps.action).toBe('return');
    });

    it('resets when the admin session is lost', async () => {
        await loaded();
        useAdminStore().reset();
        await flush();
        expect(snaps.list).toBeNull();
        expect(snaps.phase).toBe('idle');
    });
});
