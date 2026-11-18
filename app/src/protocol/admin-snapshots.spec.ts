import { describe, expect, it } from 'vitest';
import { snapshotBootParams, toRescueStatus, toSnapshotList } from './admin-snapshots';
import { adminReplyTimeoutMs, SNAPSHOT_ACTION_TIMEOUT_MS } from './admin';

describe('toSnapshotList', () => {
    it('keeps the daemon order and maps every field', () => {
        const list = toSnapshotList({
            booted: { id: 1 },
            apt_snapshots: true,
            snapshots: [
                { id: 145, date: '2026-11-17T10:00:00+01:00', type: 'post', pre_id: 144, description: 'apt', cleanup: 'number', current: false, default: false, bootable: true },
                { id: 1, date: '', type: 'single', description: '', current: true, default: true, bootable: false },
            ],
        });
        expect(list.booted).toBe(1);
        expect(list.aptSnapshots).toBe(true);
        expect(list.snapshots.map((s) => s.id)).toEqual([145, 1]);
        expect(list.snapshots[0]).toEqual({
            id: 145, date: '2026-11-17T10:00:00+01:00', type: 'post', preId: 144, description: 'apt', cleanup: 'number',
            current: false, default: false, bootable: true,
        });
        expect(list.snapshots[1].date).toBe('');
        expect(list.snapshots[1]).toMatchObject({ preId: 0, cleanup: '' });
    });

    it('drops rows without a usable id and blanks an unknown type', () => {
        const list = toSnapshotList({
            booted: null,
            snapshots: [{ id: '3' }, { id: 0 }, { id: 2.5 }, null, { id: 7, type: 'weird' }],
        });
        expect(list.snapshots.map((s) => s.id)).toEqual([7]);
        expect(list.snapshots[0].type).toBe('');
        expect(list.booted).toBeNull();
        expect(list.aptSnapshots).toBe(false);
    });

    it('survives a malformed result', () => {
        expect(toSnapshotList(null)).toEqual({ booted: null, snapshots: [], aptSnapshots: false });
        expect(toSnapshotList({ snapshots: 'x' }).snapshots).toEqual([]);
    });
});

describe('toRescueStatus', () => {
    it('defaults missing flags to false', () => {
        expect(toRescueStatus({ snapshot: null })).toEqual({ rescue: false, overlay: false, snapshot: null });
        expect(toRescueStatus(undefined)).toEqual({ rescue: false, overlay: false, snapshot: null });
    });

    it('reads a rescue boot', () => {
        expect(toRescueStatus({ rescue: true, overlay: true, snapshot: 142 })).toEqual({ rescue: true, overlay: true, snapshot: 142 });
    });

    it('does not take a truthy string for true', () => {
        expect(toRescueStatus({ rescue: 'true', snapshot: '142' })).toEqual({ rescue: false, overlay: false, snapshot: null });
    });
});

describe('snapshot actions', () => {
    it('sends the id as a JSON integer', () => {
        expect(JSON.stringify(snapshotBootParams(142))).toBe('{"id":142}');
    });

    it('waits longer than the relay for boot and rollback', () => {
        expect(adminReplyTimeoutMs('snapshot_boot')).toBe(SNAPSHOT_ACTION_TIMEOUT_MS);
        expect(adminReplyTimeoutMs('snapshot_rollback')).toBe(SNAPSHOT_ACTION_TIMEOUT_MS);
        expect(SNAPSHOT_ACTION_TIMEOUT_MS).toBeGreaterThan(35_000);
    });
});
