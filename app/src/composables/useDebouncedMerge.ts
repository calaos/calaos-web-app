// Collects partial updates and hands them over as ONE merged object once the
// caller has been quiet for `delayMs`.
//
// A held arrow key or a run of taps on a +/- button produces a stream of
// commits; a climate device takes a partial JSON update, so the stream
// collapses into a single command carrying the last value of every field.

import { getCurrentScope, onScopeDispose } from 'vue';

export interface DebouncedMerge<T extends object> {
    push: (partial: Partial<T>) => void;
    /** Sends what is queued now, if anything. */
    flush: () => void;
    /** Whether something is waiting for the delay to elapse. */
    isQueued: () => boolean;
}

export function useDebouncedMerge<T extends object>(
    send: (merged: Partial<T>) => void,
    delayMs: number,
): DebouncedMerge<T> {
    let queued: Partial<T> | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function flush() {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        if (queued === null) return;
        const merged = queued;
        queued = null;
        send(merged);
    }

    function push(partial: Partial<T>) {
        queued = { ...queued, ...partial };
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(flush, delayMs);
    }

    // Leaving the room view mid-drag must not drop the user's last choice.
    if (getCurrentScope()) onScopeDispose(flush);

    return { push, flush, isQueued: () => queued !== null };
}
