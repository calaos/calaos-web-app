import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { MIN_SPINNER_MS, useMinDuration } from './useMinDuration';
import type { MinDuration } from './useMinDuration';
import type { EffectScope, Ref } from 'vue';

let scope: EffectScope;

/** Runs the composable inside a scope, so onScopeDispose has one to hook. */
function held(source: Ref<boolean>, ms?: number): MinDuration {
    return scope.run(() => useMinDuration(source, ms)) as MinDuration;
}

beforeEach(() => {
    vi.useFakeTimers();
    scope = effectScope();
});

afterEach(() => {
    scope.stop();
    vi.useRealTimers();
});

describe('useMinDuration', () => {
    it('defaults to a 400 ms floor', () => {
        expect(MIN_SPINNER_MS).toBe(400);
    });

    it('mirrors the source when it starts false', () => {
        const source = ref(false);

        expect(held(source).active.value).toBe(false);
    });

    it('adopts a source that is already true', () => {
        const source = ref(true);

        expect(held(source).active.value).toBe(true);
    });

    it('rises with the source, immediately', async () => {
        const source = ref(false);
        const flag = held(source);

        source.value = true;
        await nextTick();

        expect(flag.active.value).toBe(true);
    });

    it('keeps a flash-length source raised for the whole floor', async () => {
        const source = ref(false);
        const flag = held(source);

        source.value = true;
        await nextTick();
        // The mock server answers a login in single-digit milliseconds.
        vi.advanceTimersByTime(5);
        source.value = false;
        await nextTick();

        expect(flag.active.value).toBe(true);

        vi.advanceTimersByTime(MIN_SPINNER_MS - 5 - 1);
        await nextTick();
        expect(flag.active.value).toBe(true);

        vi.advanceTimersByTime(1);
        await nextTick();
        expect(flag.active.value).toBe(false);
    });

    it('releases at once when the source outlived the floor', async () => {
        const source = ref(false);
        const flag = held(source);

        source.value = true;
        await nextTick();
        vi.advanceTimersByTime(MIN_SPINNER_MS * 3);
        source.value = false;
        await nextTick();

        expect(flag.active.value).toBe(false);
    });

    it('restarts the floor on a second rising edge', async () => {
        const source = ref(false);
        const flag = held(source);

        source.value = true;
        await nextTick();
        source.value = false;
        await nextTick();

        // Retry 100 ms in: the first countdown is abandoned, so the flag must
        // NOT drop at 400 ms from the first press.
        vi.advanceTimersByTime(100);
        source.value = true;
        await nextTick();
        source.value = false;
        await nextTick();

        vi.advanceTimersByTime(MIN_SPINNER_MS - 100);
        await nextTick();
        expect(flag.active.value).toBe(true);

        vi.advanceTimersByTime(100);
        await nextTick();
        expect(flag.active.value).toBe(false);
    });

    it('honours an explicit duration', async () => {
        const source = ref(false);
        const flag = held(source, 50);

        source.value = true;
        await nextTick();
        source.value = false;
        await nextTick();

        vi.advanceTimersByTime(49);
        await nextTick();
        expect(flag.active.value).toBe(true);

        vi.advanceTimersByTime(1);
        await nextTick();
        expect(flag.active.value).toBe(false);
    });

    it('accepts a getter as the source', async () => {
        const busy = ref(false);
        const flag = scope.run(() => useMinDuration(() => busy.value)) as MinDuration;

        busy.value = true;
        await nextTick();

        expect(flag.active.value).toBe(true);
    });

    describe('remaining()', () => {
        it('owes nothing while the source is down', () => {
            expect(held(ref(false)).remaining()).toBe(0);
        });

        it('counts the floor down while the source is up', async () => {
            const source = ref(false);
            const flag = held(source);

            source.value = true;
            await nextTick();
            expect(flag.remaining()).toBe(MIN_SPINNER_MS);

            vi.advanceTimersByTime(150);
            expect(flag.remaining()).toBe(MIN_SPINNER_MS - 150);
        });

        it('owes nothing once the source has outlived the floor', async () => {
            const source = ref(false);
            const flag = held(source);

            source.value = true;
            await nextTick();
            // Still active (the source never dropped), but nothing is owed:
            // a slow server must not add a wait of its own.
            vi.advanceTimersByTime(MIN_SPINNER_MS + 1);

            expect(flag.active.value).toBe(true);
            expect(flag.remaining()).toBe(0);
        });
    });

    it('drops its pending timer when the scope is stopped', async () => {
        const source = ref(false);
        held(source);

        source.value = true;
        await nextTick();
        source.value = false;
        await nextTick();
        scope.stop();

        expect(vi.getTimerCount()).toBe(0);
    });
});
