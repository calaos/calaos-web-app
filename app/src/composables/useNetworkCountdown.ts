// The time left on a pending network change, ticking on the same monotonic
// clock the store set the deadline on.

import { computed, onMounted, onUnmounted, ref } from 'vue';
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

    onMounted(() => {
        ticker = setInterval(() => {
            now.value = monotonicNow();
        }, 250);
    });

    onUnmounted(() => {
        if (ticker !== null) clearInterval(ticker);
    });

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
