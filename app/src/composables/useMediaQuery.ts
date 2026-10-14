import { getCurrentScope, onScopeDispose, ref } from 'vue';
import type { Ref } from 'vue';

/** Tracks a CSS media query; false where `matchMedia` does not exist. */
export function useMediaQuery(query: string): Ref<boolean> {
    const matches = ref(false);
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return matches;

    const list = window.matchMedia(query);
    matches.value = list.matches;
    const update = (event: MediaQueryListEvent) => {
        matches.value = event.matches;
    };
    list.addEventListener('change', update);
    if (getCurrentScope()) onScopeDispose(() => list.removeEventListener('change', update));
    return matches;
}
