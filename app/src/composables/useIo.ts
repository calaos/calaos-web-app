// useIo(id) — the single accessor every IO component uses.
//
// Everything is computed against the home store, so a component never holds a
// copy of an IO: an io_changed event mutates the store's Map entry and the
// component re-renders. `set()` goes through the store's set_state pending
// bookkeeping (see stores/home.ts) — deliberately NOT optimistic.

import { computed, toValue } from 'vue';
import type { ComputedRef, MaybeRefOrGetter } from 'vue';
import { useHomeStore } from '../stores/home';
import type { IoItem } from '../protocol/types';

export interface UseIo {
    /** undefined when the id is unknown (IO deleted, stale route param…). */
    io: ComputedRef<IoItem | undefined>;
    /** A set_state is in flight for this IO (cleared by io_changed or 5 s). */
    isPending: ComputedRef<boolean>;
    /** Sends a raw wire action value; false when the socket is not open. */
    set: (value: string) => boolean;
}

export function useIo(id: MaybeRefOrGetter<string>): UseIo {
    const home = useHomeStore();
    // The id may itself be reactive (a route param, a v-for over ioIds).
    const ioId = computed(() => toValue(id));

    return {
        io: computed(() => home.ios.get(ioId.value)),
        isPending: computed(() => home.pending.has(ioId.value)),
        set: (value: string) => home.sendSetState(ioId.value, value),
    };
}
