// useMinDuration(source, ms) — holds a boolean true for AT LEAST `ms`.
//
// The login button's progress state is the only consumer today. Against the
// mock server (and against a calaos_server on the same LAN) a login answer
// comes back in single-digit milliseconds, so a spinner bound straight to
// `auth.isPending` appears and disappears inside one frame: the user presses
// the button and something flickers. Worse on the failure path, where the
// flicker is immediately followed by the shake, so the two read as one glitch
// rather than as "we tried, it was refused".
//
// Holding the flag for a floor of 400 ms turns that into a single legible
// beat. It is NOT the old app's artificial delay (a flat 1.5 s `$timeout` on
// EVERY sign-in, see docs/ARCHITECTURE.md "Service layer"): this floor is a
// ceiling on lateness, not a fixed wait. A server that takes 900 ms to answer
// adds nothing at all.
//
// `remaining()` exists because the indicator has two consumers with opposite
// shapes: the button reads `active` (a boolean it renders), while the route
// guard that keeps the login screen on stage long enough to be seen needs the
// number of milliseconds still owed. See LoginView.vue.
//
// `Date.now()` rather than a fixed timeout from the rising edge: a source that
// stays true for 3 s must release immediately, not 400 ms after it drops.

import { onScopeDispose, readonly, ref, toValue, watch } from 'vue';
import type { MaybeRefOrGetter, Ref } from 'vue';

/** The floor the login button's progress indicator is held for. */
export const MIN_SPINNER_MS = 400;

export interface MinDuration {
    /** True from the source's rising edge until the floor has elapsed. */
    active: Readonly<Ref<boolean>>;
    /** Milliseconds still owed to the current floor; 0 once it is paid. */
    remaining: () => number;
}

export function useMinDuration(
    source: MaybeRefOrGetter<boolean>,
    ms: number = MIN_SPINNER_MS,
): MinDuration {
    const held = ref(toValue(source));
    let raisedAt = held.value ? Date.now() : 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function cancel(): void {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    }

    watch(
        () => toValue(source),
        (active) => {
            if (active) {
                // A new rising edge restarts the floor, so a retry gets its
                // own full beat instead of inheriting the previous one.
                cancel();
                raisedAt = Date.now();
                held.value = true;
                return;
            }

            const remaining = raisedAt + ms - Date.now();
            if (remaining <= 0) {
                cancel();
                held.value = false;
                return;
            }
            // Already counting down (source flapped true→false→true→false
            // inside one floor): the running timer already targets the right
            // instant, restarting it would push the release further out.
            if (timer !== null) return;

            timer = setTimeout(() => {
                timer = null;
                held.value = false;
            }, remaining);
        },
    );

    // The view can unmount mid-countdown (the router navigates to /home as
    // soon as the house data lands); a timer writing to a dead ref is
    // harmless but the handle should not outlive the scope.
    onScopeDispose(cancel);

    return {
        active: readonly(held),
        remaining: () => (held.value ? Math.max(0, raisedAt + ms - Date.now()) : 0),
    };
}
