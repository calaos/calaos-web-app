import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { BANNER_DELAY_MS, useConnectionStore } from './connection';
import type { ConnectionStatus } from '../protocol/socket';

function status(
    status: ConnectionStatus,
    attempt = 0,
    nextRetryMs = 0,
): { status: ConnectionStatus; attempt: number; nextRetryMs: number } {
    return { status, attempt, nextRetryMs };
}

beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
});

afterEach(() => {
    vi.useRealTimers();
});

describe('connection store', () => {
    it('starts connecting, with no banner', () => {
        const store = useConnectionStore();

        expect(store.status).toBe('connecting');
        expect(store.attempt).toBe(0);
        expect(store.nextRetryMs).toBe(0);
        expect(store.showBanner).toBe(false);
        expect(store.isOpen).toBe(false);
    });

    it('mirrors the socket statuschange payload', () => {
        const store = useConnectionStore();

        store.applyStatus(status('reconnecting', 3, 3375));

        expect(store.status).toBe('reconnecting');
        expect(store.attempt).toBe(3);
        expect(store.nextRetryMs).toBe(3375);
        expect(store.isOpen).toBe(false);

        store.applyStatus(status('open'));
        expect(store.isOpen).toBe(true);
    });
});

describe('banner debounce', () => {
    it('shows only after 1 s of continuous non-open', () => {
        const store = useConnectionStore();
        store.applyStatus(status('open'));

        store.applyStatus(status('reconnecting', 1, 1000));
        vi.advanceTimersByTime(BANNER_DELAY_MS - 1);
        expect(store.showBanner).toBe(false);

        vi.advanceTimersByTime(1);
        expect(store.showBanner).toBe(true);
    });

    it('does not restart the countdown on every retry event', () => {
        const store = useConnectionStore();
        store.applyStatus(status('open'));

        store.applyStatus(status('reconnecting', 1, 1000));
        vi.advanceTimersByTime(600);
        // The socket re-emits 'reconnecting' per attempt with a fresh delay.
        store.applyStatus(status('reconnecting', 2, 1500));
        vi.advanceTimersByTime(399);
        expect(store.showBanner).toBe(false);

        vi.advanceTimersByTime(1);
        expect(store.showBanner).toBe(true);
    });

    it('never flashes for an outage shorter than the delay', () => {
        const store = useConnectionStore();
        store.applyStatus(status('open'));

        store.applyStatus(status('reconnecting', 1, 1000));
        vi.advanceTimersByTime(900);
        store.applyStatus(status('open'));

        vi.advanceTimersByTime(10 * BANNER_DELAY_MS);
        expect(store.showBanner).toBe(false);
    });

    it('hides again as soon as the socket reopens', () => {
        const store = useConnectionStore();
        store.applyStatus(status('reconnecting', 1, 1000));
        vi.advanceTimersByTime(BANNER_DELAY_MS);
        expect(store.showBanner).toBe(true);

        store.applyStatus(status('open'));
        expect(store.showBanner).toBe(false);

        // …and the stale timer cannot bring it back.
        vi.advanceTimersByTime(10 * BANNER_DELAY_MS);
        expect(store.showBanner).toBe(false);
    });

    it('re-arms for the next outage', () => {
        const store = useConnectionStore();
        store.applyStatus(status('reconnecting', 1, 1000));
        vi.advanceTimersByTime(BANNER_DELAY_MS);
        store.applyStatus(status('open'));

        store.applyStatus(status('reconnecting', 1, 1000));
        vi.advanceTimersByTime(BANNER_DELAY_MS - 1);
        expect(store.showBanner).toBe(false);
        vi.advanceTimersByTime(1);
        expect(store.showBanner).toBe(true);
    });

    it('arms on the initial connecting status too (server down on load)', () => {
        const store = useConnectionStore();
        store.applyStatus(status('connecting'));

        vi.advanceTimersByTime(BANNER_DELAY_MS);
        expect(store.showBanner).toBe(true);
    });

    it('reset() clears the state and the pending timer', () => {
        const store = useConnectionStore();
        store.applyStatus(status('reconnecting', 4, 5062.5));

        store.reset();
        expect(store.status).toBe('connecting');
        expect(store.attempt).toBe(0);
        expect(store.nextRetryMs).toBe(0);

        vi.advanceTimersByTime(10 * BANNER_DELAY_MS);
        expect(store.showBanner).toBe(false);
    });
});
