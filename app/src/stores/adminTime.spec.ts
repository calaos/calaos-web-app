import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminStore } from './admin';
import { useAdminTimeStore } from './adminTime';
import { fail, flush, harness, last, ok, setUp, unlocked } from './adminTestHarness';

const PARIS = { now: '2026-10-25T09:00:00Z', timezone: 'Europe/Paris', ntp: true, synchronized: true, rtc: null };

beforeEach(setUp);

afterEach(() => {
    vi.useRealTimers();
});

describe('time store', () => {
    it('keeps restart_required after a timezone change, even a partial one', async () => {
        await unlocked();
        const time = useAdminTimeStore();
        const pending = time.set({ timezone: 'UTC', ntp: false });
        expect(last().data.params).toEqual({ timezone: 'UTC', ntp: false });
        fail('internal', { applied: 'timezone', failed: 'ntp', restart_required: 'true' });
        expect((await pending)?.failed).toBe('ntp');
        expect(time.restartRequired).toBe(true);
        expect(last().data.action).toBe('time_get');
    });

    it('an older daemon stays in the card: the Admin page stays unlocked', async () => {
        await unlocked();
        const time = useAdminTimeStore();
        void time.load();
        fail('daemon_too_old');
        await flush();
        expect(useAdminStore().gate).toBe('unlocked');
        expect(time.error?.code).toBe('daemon_too_old');
    });

    it('an unknown outcome is read back, never resent, and a new zone asks for the restart', async () => {
        await unlocked();
        const time = useAdminTimeStore();
        void time.load();
        ok(PARIS);
        await flush();
        harness.sent = [];
        const pending = time.set({ timezone: 'UTC', ntp: false });
        fail('daemon_unreachable', { outcome: 'unknown' });
        await flush();
        expect(last().data.action).toBe('time_get');
        ok({ ...PARIS, timezone: 'UTC' });
        expect(await pending).toBeNull();
        expect(useAdminStore().gate).toBe('unlocked');
        expect(time.unconfirmed).toEqual({ changed: ['timezone'], unchanged: ['ntp'], restartRequired: true });
        expect(time.restartRequired).toBe(true);
        expect(time.error).toBeNull();
        expect(harness.sent.map((frame) => frame.data.action)).toEqual(['time_set', 'time_get']);
    });

    it('an unknown outcome the box cannot be read for waits for a check, still without resending', async () => {
        await unlocked();
        const time = useAdminTimeStore();
        void time.load();
        ok(PARIS);
        await flush();
        harness.sent = [];
        const pending = time.set({ ntp: false });
        fail('admin_unavailable', { outcome: 'unknown' });
        await flush();
        fail('internal');
        expect(await pending).toBeNull();
        expect(time.unconfirmed).toBe('unread');

        void time.checkAgain();
        ok({ ...PARIS, ntp: false, synchronized: false });
        await flush();
        expect(time.unconfirmed).toEqual({ changed: ['ntp'], unchanged: [], restartRequired: false });
        expect(time.restartRequired).toBe(false);
        expect(harness.sent.map((frame) => frame.data.action)).toEqual(['time_set', 'time_get', 'time_get']);
    });

    it('gives time_set 40 s', async () => {
        await unlocked();
        const time = useAdminTimeStore();
        let done = false;
        void time.set({ ntp: true }).then(() => (done = true));
        vi.advanceTimersByTime(39_000);
        await flush();
        expect(done).toBe(false);
        vi.advanceTimersByTime(1_000);
        await flush();
        expect(done).toBe(true);
    });
});
