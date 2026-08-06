// useCameraPoll(url) — one camera's snapshot chain.
//
// The old app (src/scripts/camera-directive.js) drew every frame into a
// canvas and, on each `load`, queued the next request through a 10 ms
// `$timeout`: a request every ~10 ms per camera, each one waking an Angular
// digest, three cameras at a time on the list screen. It also never handled
// `error`, so a camera that stopped answering silently ended its own chain and
// left a blank canvas on screen forever.
//
// What replaces it (docs/ARCHITECTURE.md "Camera polling"):
//
//  - No canvas. A plain `<img>` whose `src` this composable owns; the browser
//    keeps the previous frame on screen until the next one has decoded, which
//    is the only thing the canvas was buying.
//  - CHAINED, not intervalled: the next request is scheduled from the previous
//    frame's `load`, so a slow camera is never asked for two frames at once.
//    250 ms between frames — visibly live, and 25× less traffic than 10 ms.
//  - `error` is a first-class outcome: exponential backoff from 1 s to 10 s,
//    and after three consecutive failures the view is told to show a
//    placeholder. The chain keeps running behind that placeholder, so a camera
//    that comes back is shown again without anyone touching the page; `retry()`
//    only short-circuits the wait.
//  - Paused while the document is hidden. A wall panel with the screen off, or
//    a phone with the tab in the background, has no business pulling four
//    frames a second over someone's ADSL uplink.
//  - Stopped when the owning scope goes away (unmount, route leave).
//
// The `load`/`error` handlers are returned rather than attached: the element
// belongs to the component (components/camera/CameraFrame.vue), so it binds
// them with `@load`/`@error` and this module never touches the DOM — which is
// also what lets the spec drive the whole state machine with fake timers.

import { onScopeDispose, readonly, ref, toValue, watch } from 'vue';
import type { MaybeRefOrGetter, Ref } from 'vue';

/** Delay between a decoded frame and the request for the next one. */
export const FRAME_INTERVAL_MS = 250;
/** First wait after a failed frame. */
export const BACKOFF_MIN_MS = 1000;
/** The backoff doubles up to this ceiling and stays there. */
export const BACKOFF_MAX_MS = 10_000;
/** Consecutive failures before the view is told the camera is down. */
export const ERROR_LIMIT = 3;

export interface CameraPoll {
    /** URL to bind to the `<img>`; '' until the first request goes out. */
    src: Readonly<Ref<string>>;
    /** True after ERROR_LIMIT consecutive failures; false again on any frame. */
    error: Readonly<Ref<boolean>>;
    /** True once a frame has decoded — i.e. there is a picture on screen. */
    loaded: Readonly<Ref<boolean>>;
    /** Bind to the img's `load`. */
    onLoad: () => void;
    /** Bind to the img's `error`. */
    onError: () => void;
    /** The placeholder's button: clears the error, resets the backoff, asks now. */
    retry: () => void;
}

export function useCameraPoll(url: MaybeRefOrGetter<string>): CameraPoll {
    const src = ref('');
    const error = ref(false);
    const loaded = ref(false);

    // Not state: nothing below is rendered, and a re-render per backoff step
    // would be a re-render for nobody.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = BACKOFF_MIN_MS;
    let consecutiveErrors = 0;
    /** A request is out and its load/error event is still to come. */
    let inFlight = false;
    /** False once the scope is disposed — the hard stop. */
    let running = true;

    function clearTimer(): void {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    }

    /** Nothing is asked for while the document is hidden. */
    function paused(): boolean {
        return document.hidden;
    }

    /**
     * Asks for a frame NOW.
     *
     * The `&t=` cache-buster is what makes the request a request: the URL is
     * otherwise identical every time, and a browser is free to answer it from
     * cache (the mock sends `cache-control: no-store`, a real camera proxy may
     * not). Kept from the old directive, which appended the same timestamp.
     */
    function request(): void {
        clearTimer();
        inFlight = true;
        src.value = `${toValue(url)}&t=${Date.now()}`;
    }

    function schedule(delayMs: number): void {
        clearTimer();
        timer = setTimeout(request, delayMs);
    }

    /** Schedules unless the chain is stopped or the tab is in the background. */
    function scheduleUnlessPaused(delayMs: number): void {
        if (!running || paused()) return;
        schedule(delayMs);
    }

    function onLoad(): void {
        inFlight = false;
        loaded.value = true;
        // A frame is a full recovery: the placeholder goes away and the next
        // failure starts counting (and waiting) from scratch.
        consecutiveErrors = 0;
        backoffMs = BACKOFF_MIN_MS;
        error.value = false;
        scheduleUnlessPaused(FRAME_INTERVAL_MS);
    }

    function onError(): void {
        inFlight = false;
        consecutiveErrors += 1;
        if (consecutiveErrors >= ERROR_LIMIT) error.value = true;

        // Wait the CURRENT backoff, then double it: 1 s, 2 s, 4 s, 8 s, 10 s,
        // 10 s… A camera that is down for the afternoon costs six requests an
        // hour, and one that blinks is back within a second.
        const delayMs = backoffMs;
        backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
        scheduleUnlessPaused(delayMs);
    }

    /** Clears the failure bookkeeping and asks again immediately. */
    function restart(): void {
        consecutiveErrors = 0;
        backoffMs = BACKOFF_MIN_MS;
        error.value = false;
        if (!running || paused()) return;
        request();
    }

    function onVisibilityChange(): void {
        if (!running) return;
        if (paused()) {
            // Only the pending timer is dropped. A request already out is left
            // to finish — its own event resumes the chain if the document is
            // visible again by then, and is otherwise the last one.
            clearTimer();
            return;
        }
        if (!inFlight) request();
    }

    // A different camera (the /security/:cameraId param changing without a
    // remount) or new credentials: the picture on screen belongs to the old
    // URL, so the chain starts over instead of showing it for up to one
    // backoff.
    watch(
        () => toValue(url),
        () => {
            loaded.value = false;
            restart();
        },
    );

    document.addEventListener('visibilitychange', onVisibilityChange);

    onScopeDispose(() => {
        // The hard stop: no timer, no listener, and any load/error event still
        // in flight schedules nothing (see scheduleUnlessPaused).
        running = false;
        clearTimer();
        document.removeEventListener('visibilitychange', onVisibilityChange);
    });

    // Mounted with the tab in the background (a restored session, a
    // background-loaded page): stay quiet, the visibility handler starts the
    // chain when someone is actually looking.
    if (!paused()) request();

    return {
        src: readonly(src),
        error: readonly(error),
        loaded: readonly(loaded),
        onLoad,
        onError,
        retry: restart,
    };
}
