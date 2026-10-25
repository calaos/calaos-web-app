import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminEventMessage } from '../protocol/types';
import { useAdminStore } from './admin';
import { useAdminNetworkStore } from './adminNetwork';
import { useApproversStore } from './approvers';
import { SESSION, fail, flush, harness, last, ok, setUp, unlocked } from './adminTestHarness';

/** Seconds left on the countdown, as the view shows them. */
function secondsLeft(deadline: number | undefined | null): number {
    return Math.ceil(((deadline ?? 0) - performance.now()) / 1000);
}

const event = (type: string, data: unknown): AdminEventMessage => ({ kind: 'admin_event', type, ts: '', data });

const APPROVER = { id: '1111111111111111', device_name: 'Pixel 8', token_id: '0c1d2e3f4a5b6c7d', created_at: '2026-10-01T00:00:00Z', last_seen: '2026-10-25T09:00:00Z' };

beforeEach(setUp);

afterEach(() => {
    vi.useRealTimers();
});

describe('network store', () => {
    const change = { intf: 'eth0', dhcp: false, ipv4: '192.168.1.20/24', gateway: '192.168.1.1' };

    it('asks a network_config code bound to the fields, applies with it, counts down confirm_within', async () => {
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
        expect(network.pending).toMatchObject({ changeId: '5d0c8e1f2a3b4c6d', appliedAt: '2026-10-25T09:12:03Z', change });
        // The browser's wall clock is not 2026-10-25: the countdown does not
        // care. One second is kept in hand for the box's rounding.
        expect(secondsLeft(network.pending?.deadline)).toBe(119);
        vi.advanceTimersByTime(20_000);
        expect(secondsLeft(network.pending?.deadline)).toBe(99);

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
        expect(secondsLeft(network.pending?.deadline)).toBe(29);

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

    it('a reply that never comes (40 s, past calaos_server\'s 35 s) is treated the same way', async () => {
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
        vi.advanceTimersByTime(39_000);
        await flush();
        expect(network.lostApply).toBeNull();
        vi.advanceTimersByTime(1_000);
        await flush();
        expect(approvers.done).toBe('network');
        expect(network.lostApply).toEqual(change);
    });

    it('a pending event published again after a daemon restart keeps the original window', async () => {
        await unlocked();
        const network = useAdminNetworkStore();
        network.handleEvent(
            event('network_pending', { intf: 'eth0', change_id: '5d0c8e1f2a3b4c6d', applied_at: '2026-10-25T09:12:03Z', confirm_within: 30 }),
        );
        expect(network.pending).toMatchObject({ changeId: '5d0c8e1f2a3b4c6d', intf: 'eth0', change: null });
        expect(secondsLeft(network.pending?.deadline)).toBe(29);
    });

    it('the reply and the event of one apply keep the earlier deadline and our change', async () => {
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
        network.handleEvent(
            event('network_pending', { intf: 'eth0', change_id: '5d0c8e1f2a3b4c6d', applied_at: '2026-10-25T09:12:03Z', confirm_within: 118 }),
        );
        vi.advanceTimersByTime(1_000);
        ok({ change_id: '5d0c8e1f2a3b4c6d', intf: 'eth0', applied_at: '2026-10-25T09:12:03Z', confirm_within: 120 });
        await flush();
        expect(network.pending?.change).toEqual(change);
        expect(secondsLeft(network.pending?.deadline)).toBe(116);
    });

    it('a lost reply bounds the countdown from the moment the apply was sent', async () => {
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
        vi.advanceTimersByTime(40_000);
        await flush();
        expect(secondsLeft(network.lostDeadline)).toBe(80);
        network.reset();
        expect(network.lostDeadline).toBeNull();
    });

    it('network_pending on apply reads the change already waiting', async () => {
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
        fail('network_pending', { change_id: '0123456789abcdef', expires_in: '42' });
        await flush();
        expect(approvers.challenge?.error?.code).toBe('network_pending');
        expect(last().data.action).toBe('network_state');
        ok({ interfaces: [], pending: { change_id: '0123456789abcdef', intf: 'eth1', applied_at: '2026-10-25T09:12:03Z', expires_in: 42 } });
        await flush();
        expect(network.pending).toMatchObject({ changeId: '0123456789abcdef', intf: 'eth1', change: null });
    });

    it('an older daemon refusing network_state stays in this panel, the Admin page stays unlocked', async () => {
        await unlocked();
        const network = useAdminNetworkStore();
        void network.load();
        fail('daemon_too_old');
        await flush();
        expect(useAdminStore().gate).toBe('unlocked');
        expect(network.error?.code).toBe('daemon_too_old');
    });

    it('a keep that gets no answer marks the box unanswered, not the server too old', async () => {
        await unlocked();
        const network = useAdminNetworkStore();
        void network.load();
        ok({ interfaces: [], pending: { change_id: '5d0c8e1f2a3b4c6d', intf: 'eth0', applied_at: '2026-10-25T09:12:03Z', expires_in: 100 } });
        await flush();
        const kept = network.confirm();
        vi.advanceTimersByTime(40_000);
        expect((await kept)?.code).toBe('timeout');
        expect(network.unanswered).toBe(true);
        expect(useAdminStore().gate).toBe('unlocked');
        expect(network.pending).not.toBeNull();
    });

    it('remembers the address the interface had, and a keep from elsewhere ends the trial here', async () => {
        await unlocked();
        const approvers = useApproversStore();
        void approvers.load();
        ok([APPROVER]);
        await flush();
        const network = useAdminNetworkStore();
        void network.load();
        ok({
            interfaces: [{ name: 'eth0', ipv4: '192.168.1.10/24', gateway: '', mac: '', state: 'routable', dhcp: false, dns_servers: [], search_domains: [] }],
            pending: null,
        });
        await flush();
        void network.startApply(change);
        expect(network.appliedFrom).toBe('192.168.1.10');
        ok({ code_id: 'c0c0c0c0c0c0c0c0', approver_id: APPROVER.id, expires_in: 60 });
        await flush();
        void approvers.submit('482913');
        ok({ change_id: '5d0c8e1f2a3b4c6d', intf: 'eth0', applied_at: '2026-10-25T09:12:03Z', confirm_within: 120 });
        await flush();
        harness.sent = [];
        network.handleEvent(event('network_applied', { intf: 'eth0', change_id: '5d0c8e1f2a3b4c6d' }));
        expect(network.pending).toBeNull();
        expect(network.finished).toEqual({ changeId: '5d0c8e1f2a3b4c6d', intf: 'eth0', state: 'confirmed' });
        expect(harness.sent.map((frame) => frame.data.action)).toEqual(['network_state']);
    });

    it('our own keep reads the state once, whichever of its event and reply comes first', async () => {
        await unlocked();
        const network = useAdminNetworkStore();
        void network.load();
        ok({ interfaces: [], pending: { change_id: '5d0c8e1f2a3b4c6d', intf: 'eth0', applied_at: '2026-10-25T09:12:03Z', expires_in: 100 } });
        await flush();
        harness.sent = [];
        void network.confirm();
        network.handleEvent(event('network_applied', { intf: 'eth0', change_id: '5d0c8e1f2a3b4c6d' }));
        ok({ change_id: '5d0c8e1f2a3b4c6d', intf: 'eth0', state: 'confirmed' });
        await flush();
        network.handleEvent(event('network_applied', { intf: 'eth0', change_id: '5d0c8e1f2a3b4c6d' }));
        expect(harness.sent.map((frame) => frame.data.action)).toEqual(['network_confirm', 'network_state']);
    });
});
