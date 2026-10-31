// The time left on a pending network change, ticking on the same monotonic
// clock the store set the deadline on.

import { computed, onScopeDispose, ref, watch } from 'vue';
import type { ComputedRef } from 'vue';
import { NETWORK_CONFIRM_WINDOW_S, monotonicNow } from '../protocol/admin-network';

export interface NetworkCountdown {
    /** Whole seconds left, 0 once over; null without a deadline. */
    seconds: ComputedRef<number | null>;
    /** `m:ss`. */
    clock: ComputedRef<string>;
    /** 1 → 0 over the 120 s window. */
    fraction: ComputedRef<number>;
}

export function formatCountdown(seconds: number): string {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function useNetworkCountdown(deadline: () => number | null): NetworkCountdown {
    const now = ref(monotonicNow());
    let ticker: ReturnType<typeof setInterval> | null = null;

    function stop(): void {
        if (ticker !== null) clearInterval(ticker);
        ticker = null;
    }

    // Ticks only while there is something to count down.
    watch(
        () => deadline() !== null,
        (counting) => {
            if (!counting) {
                stop();
                return;
            }
            now.value = monotonicNow();
            ticker ??= setInterval(() => {
                now.value = monotonicNow();
            }, 250);
        },
        { immediate: true },
    );

    onScopeDispose(stop);

    const left = computed(() => {
        const end = deadline();
        return end === null ? null : Math.max(0, (end - now.value) / 1000);
    });

    return {
        seconds: computed(() => (left.value === null ? null : Math.ceil(left.value))),
        clock: computed(() => formatCountdown(left.value ?? 0)),
        fraction: computed(() => Math.min(1, (left.value ?? 0) / NETWORK_CONFIRM_WINDOW_S)),
    };
}
