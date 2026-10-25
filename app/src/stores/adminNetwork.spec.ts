import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminEventMessage } from '../protocol/types';
import { useAdminStore } from './admin';
import { useAdminNetworkStore } from './adminNetwork';
import { useApproversStore } from './approvers';
import { SESSION, fail, flush, last, ok, setUp, unlocked } from './adminTestHarness';

const APPROVER = { id: '1111111111111111', device_name: 'Pixel 8', token_id: '0c1d2e3f4a5b6c7d', created_at: '2026-10-01T00:00:00Z', last_seen: '2026-10-25T09:00:00Z' };

beforeEach(setUp);

afterEach(() => {
    vi.useRealTimers();
});

describe('network store', () => {
    const change = { intf: 'eth0', dhcp: false, ipv4: '192.168.1.20/24', gateway: '192.168.1.1' };

    it('asks a network_config code bound to the fields, applies with it, counts from applied_at', async () => {
        await unlocked();
        const approvers = useApproversStore();
        void approvers.load();
        ok([APPROVER]);
        await flush();
        const network = useAdminNetworkStore();

        void network.startApply(change);
        expect(last().data.params).toEqual({
            code_action: 'network_config',
            code_params: { intf: 'eth0', dhcp: false, ipv4: '192.168.1.20/24', gateway: '192.168.1.1' },
            approver_id: APPROVER.id,
        });
        ok({ code_id: 'c0c0c0c0c0c0c0c0', approver_id: APPROVER.id, expires_in: 60 });
        await flush();
        expect(approvers.challenge?.step).toBe('network');

        void approvers.submit('482913');
        expect(last().data).toEqual({
            action: 'network_apply',
            admin_session: SESSION,
            params: { intf: 'eth0', dhcp: false, ipv4: '192.168.1.20/24', gateway: '192.168.1.1', code_id: 'c0c0c0c0c0c0c0c0', code: '482913' },
        });
        ok({ change_id: '5d0c8e1f2a3b4c6d', intf: 'eth0', applied_at: '2026-10-25T09:12:03Z', confirm_within: 120 });
        await flush();
        expect(approvers.done).toBe('network');
        expect(network.pending).toMatchObject({ changeId: '5d0c8e1f2a3b4c6d', deadline: Date.parse('2026-10-25T09:14:03Z') });

        void network.confirm();
        expect(last().data.params).toEqual({ change_id: '5d0c8e1f2a3b4c6d' });
        ok({ change_id: '5d0c8e1f2a3b4c6d', intf: 'eth0', state: 'confirmed' });
        await flush();
        expect(network.pending).toBeNull();
        expect(network.finished?.state).toBe('confirmed');
    });

    it('a wrong code stays in the code entry with the attempts left', async () => {
        await unlocked();
        const approvers = useApproversStore();
        void approvers.load();
        ok([APPROVER]);
        await flush();
        void useAdminNetworkStore().startApply(change);
        ok({ code_id: 'c0c0c0c0c0c0c0c0', approver_id: APPROVER.id, expires_in: 60 });
        await flush();
        void approvers.submit('000000');
        fail('bad_code', { attempts_left: '3' });
        await flush();
        expect(approvers.challenge).toMatchObject({ step: 'network', attemptsLeft: 3 });
    });

    it('restores the pending change from network_state, and follows the events', async () => {
        await unlocked();
        const network = useAdminNetworkStore();
        void network.load();
        ok({ interfaces: [], pending: { change_id: '5d0c8e1f2a3b4c6d', intf: 'eth0', applied_at: '2026-10-25T09:12:03Z', expires_in: 30 } });
        await flush();
        expect(network.pending?.deadline).toBe(Date.parse('2026-10-25T09:14:03Z'));

        const event = (type: string, data: unknown): AdminEventMessage => ({ kind: 'admin_event', type, ts: '', data });
        network.handleEvent(event('network_rolled_back', { intf: 'eth0' }));
        expect(network.pending).toBeNull();
        expect(network.rolledBack).toBe('eth0');
    });

    it('a reply lost to the box moving is not an error: the change is kept and network_state resolves it', async () => {
        await unlocked();
        const approvers = useApproversStore();
        void approvers.load();
        ok([APPROVER]);
        await flush();
        const network = useAdminNetworkStore();
        void network.startApply(change);
        ok({ code_id: 'c0c0c0c0c0c0c0c0', approver_id: APPROVER.id, expires_in: 60 });
        await flush();

        void approvers.submit('482913');
        expect(last().data.action).toBe('network_apply');
        useAdminStore().handleTransportLost();
        await flush();
        expect(approvers.challenge).toBeNull();
        expect(approvers.done).toBe('network');
        expect(network.lostApply).toEqual(change);

        network.handleLoggedIn();
        expect(last().data.action).toBe('network_state');
        ok({ interfaces: [], pending: { change_id: '5d0c8e1f2a3b4c6d', intf: 'eth0', applied_at: '2026-10-25T09:12:03Z', expires_in: 100 } });
        await flush();
        expect(network.lostApply).toBeNull();
        expect(network.pending).toMatchObject({ changeId: '5d0c8e1f2a3b4c6d', change });
    });

    it('a reply that never comes is treated the same way', async () => {
        await unlocked();
        const approvers = useApproversStore();
        void approvers.load();
        ok([APPROVER]);
        await flush();
        const network = useAdminNetworkStore();
        void network.startApply(change);
        ok({ code_id: 'c0c0c0c0c0c0c0c0', approver_id: APPROVER.id, expires_in: 60 });
        await flush();
        void approvers.submit('482913');
        vi.advanceTimersByTime(5_000);
        await flush();
        expect(approvers.done).toBe('network');
        expect(network.lostApply).toEqual(change);
    });
});
