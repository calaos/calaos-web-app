import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminTimeStore } from './adminTime';
import { fail, flush, last, setUp, unlocked } from './adminTestHarness';

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
