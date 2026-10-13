import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { useDebouncedMerge } from './useDebouncedMerge';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useDebouncedMerge', () => {
    it('sends one merged object after the quiet period', () => {
        const send = vi.fn();
        const d = useDebouncedMerge<{ a: number; b: number }>(send, 300);

        d.push({ a: 1 });
        vi.advanceTimersByTime(200);
        d.push({ a: 2, b: 3 });
        vi.advanceTimersByTime(299);
        expect(send).not.toHaveBeenCalled();
        expect(d.isQueued()).toBe(true);

        vi.advanceTimersByTime(1);
        expect(send).toHaveBeenCalledOnce();
        expect(send).toHaveBeenCalledWith({ a: 2, b: 3 });
        expect(d.isQueued()).toBe(false);
    });

    it('flushes early on demand and sends nothing twice', () => {
        const send = vi.fn();
        const d = useDebouncedMerge<{ a: number }>(send, 300);

        d.flush();
        expect(send).not.toHaveBeenCalled();

        d.push({ a: 1 });
        d.flush();
        vi.advanceTimersByTime(1000);
        expect(send).toHaveBeenCalledOnce();
    });

    it('sends what is still queued when its scope is disposed', () => {
        const send = vi.fn();
        const scope = effectScope();
        const d = scope.run(() => useDebouncedMerge<{ a: number }>(send, 300))!;

        d.push({ a: 7 });
        scope.stop();
        expect(send).toHaveBeenCalledWith({ a: 7 });
        vi.advanceTimersByTime(1000);
        expect(send).toHaveBeenCalledOnce();
    });
});
