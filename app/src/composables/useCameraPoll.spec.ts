import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import {
    BACKOFF_MAX_MS,
    BACKOFF_MIN_MS,
    ERROR_LIMIT,
    FRAME_INTERVAL_MS,
    useCameraPoll,
} from './useCameraPoll';
import type { CameraPoll } from './useCameraPoll';
import type { EffectScope, MaybeRefOrGetter } from 'vue';

// Any URL with a query string — this composable knows nothing about camera
// URLs beyond appending its cache-buster (services/camera-url.ts builds them).
const URL_A = '/api?action=camera&type=get_picture&id=camera_1';

let scope: EffectScope;
/** Backs the `document.hidden` getter installed in beforeEach. */
let hidden = false;

/** Runs the composable inside a scope, so onScopeDispose has one to hook. */
function polling(url: MaybeRefOrGetter<string> = URL_A): CameraPoll {
    return scope.run(() => useCameraPoll(url)) as CameraPoll;
}

/** What the browser does when the tab goes to the background, and back. */
function setHidden(next: boolean): void {
    hidden = next;
    document.dispatchEvent(new Event('visibilitychange'));
}

/**
 * Runs the next scheduled request and answers how long the composable waited
 * for it. Reading the fake clock is exact, where advancing by hand in steps
 * would only ever bound the delay.
 */
function waitForNextRequest(): number {
    const before = Date.now();
    vi.advanceTimersToNextTimer();
    return Date.now() - before;
}

/** The `t` of the current src — the proof that a request is a NEW request. */
function cacheBuster(poll: CameraPoll): string | null {
    const query = poll.src.value.slice(poll.src.value.indexOf('?') + 1);
    return new URLSearchParams(query).get('t');
}

beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    // happy-dom has no page lifecycle, so the flag the composable reads is
    // installed here and driven by setHidden().
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    scope = effectScope();
});

afterEach(() => {
    scope.stop();
    vi.useRealTimers();
    Reflect.deleteProperty(document, 'hidden');
});

describe('useCameraPoll — the chain', () => {
    it('asks for a frame as soon as it is created', () => {
        const poll = polling();

        expect(poll.src.value).toBe(`${URL_A}&t=${Date.now()}`);
        expect(poll.loaded.value).toBe(false);
        expect(poll.error.value).toBe(false);
    });

    it('waits for the frame it asked for before asking again', () => {
        // The old directive queued the next request 10 ms after `load`; this
        // one queues nothing at all until the browser has answered.
        const poll = polling();
        const first = poll.src.value;

        vi.advanceTimersByTime(60_000);

        expect(poll.src.value).toBe(first);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('asks for the next frame 250 ms after the previous one decoded', () => {
        const poll = polling();
        const first = poll.src.value;

        poll.onLoad();
        expect(poll.loaded.value).toBe(true);

        vi.advanceTimersByTime(FRAME_INTERVAL_MS - 1);
        expect(poll.src.value).toBe(first);

        vi.advanceTimersByTime(1);
        expect(poll.src.value).toBe(`${URL_A}&t=${Date.now()}`);
    });

    it('keeps the same URL apart from the cache-buster', () => {
        // A camera proxy that honours neither `no-store` nor `must-revalidate`
        // would otherwise hand back the same picture forever.
        const poll = polling();
        const firstBuster = cacheBuster(poll);

        poll.onLoad();
        vi.advanceTimersByTime(FRAME_INTERVAL_MS);

        expect(poll.src.value.startsWith(`${URL_A}&t=`)).toBe(true);
        expect(cacheBuster(poll)).not.toBe(firstBuster);
    });

    it('runs frame after frame for as long as the camera answers', () => {
        const poll = polling();
        const busters = new Set<string | null>([cacheBuster(poll)]);

        for (let frame = 0; frame < 10; frame += 1) {
            poll.onLoad();
            expect(waitForNextRequest()).toBe(FRAME_INTERVAL_MS);
            busters.add(cacheBuster(poll));
        }

        expect(busters.size).toBe(11);
    });
});

describe('useCameraPoll — a camera that stops answering', () => {
    it('backs off 1 s → 10 s, doubling, then holds at the ceiling', () => {
        const poll = polling();
        const delays: number[] = [];

        for (let attempt = 0; attempt < 6; attempt += 1) {
            poll.onError();
            delays.push(waitForNextRequest());
        }

        expect(delays).toEqual([1000, 2000, 4000, 8000, BACKOFF_MAX_MS, BACKOFF_MAX_MS]);
        expect(BACKOFF_MIN_MS).toBe(1000);
    });

    it('reports the camera down after three consecutive failures, not before', () => {
        const poll = polling();

        for (let attempt = 1; attempt < ERROR_LIMIT; attempt += 1) {
            poll.onError();
            // The picture (if any) is still on screen while the chain retries
            // quietly — a camera that blinks must not flash a placeholder.
            expect(poll.error.value).toBe(false);
            waitForNextRequest();
        }

        poll.onError();
        expect(poll.error.value).toBe(true);
    });

    it('keeps retrying behind the placeholder, so recovery needs no gesture', () => {
        const poll = polling();
        for (let attempt = 0; attempt < ERROR_LIMIT; attempt += 1) {
            poll.onError();
            waitForNextRequest();
        }
        expect(poll.error.value).toBe(true);

        poll.onLoad();

        expect(poll.error.value).toBe(false);
        expect(poll.loaded.value).toBe(true);
        expect(waitForNextRequest()).toBe(FRAME_INTERVAL_MS);
    });

    it('starts the backoff over after any successful frame', () => {
        const poll = polling();
        poll.onError();
        waitForNextRequest();
        poll.onError();
        expect(waitForNextRequest()).toBe(2000);

        poll.onLoad();
        waitForNextRequest();
        poll.onError();

        expect(waitForNextRequest()).toBe(BACKOFF_MIN_MS);
    });

    it('forgets earlier failures once a frame gets through', () => {
        const poll = polling();
        poll.onError();
        poll.onError();
        waitForNextRequest();

        poll.onLoad();
        waitForNextRequest();
        poll.onError();
        poll.onError();

        expect(poll.error.value).toBe(false);
    });
});

describe('useCameraPoll — retry()', () => {
    /** Three failures deep: down, and waiting 4 s for the next attempt. */
    function down(): CameraPoll {
        const poll = polling();
        for (let attempt = 0; attempt < ERROR_LIMIT; attempt += 1) {
            poll.onError();
            if (attempt < ERROR_LIMIT - 1) waitForNextRequest();
        }
        return poll;
    }

    it('asks again immediately instead of serving out the backoff', () => {
        const poll = down();
        const stale = poll.src.value;
        // The time it takes to notice the placeholder and reach for the
        // button; the 4 s backoff still has most of its wait to run.
        vi.advanceTimersByTime(100);

        poll.retry();

        expect(poll.src.value).not.toBe(stale);
        expect(poll.error.value).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('resets the backoff, so a still-dead camera waits 1 s again', () => {
        const poll = down();

        poll.retry();
        poll.onError();

        expect(waitForNextRequest()).toBe(BACKOFF_MIN_MS);
    });

    it('resets the failure count, so it takes three more to give up', () => {
        const poll = down();

        poll.retry();
        poll.onError();
        waitForNextRequest();
        poll.onError();

        expect(poll.error.value).toBe(false);
    });
});

describe('useCameraPoll — the tab in the background', () => {
    it('drops the pending request when the document is hidden', () => {
        const poll = polling();
        poll.onLoad();
        const last = poll.src.value;

        setHidden(true);
        vi.advanceTimersByTime(60_000);

        expect(vi.getTimerCount()).toBe(0);
        expect(poll.src.value).toBe(last);
    });

    it('schedules nothing while hidden, whatever the in-flight request does', () => {
        const poll = polling();
        const last = poll.src.value;

        setHidden(true);
        // The request that was already out comes back — with a frame, and
        // later with a failure. Neither may restart the chain.
        poll.onLoad();
        poll.onError();
        vi.advanceTimersByTime(60_000);

        expect(vi.getTimerCount()).toBe(0);
        expect(poll.src.value).toBe(last);
    });

    it('picks the chain straight back up when the document is shown', () => {
        const poll = polling();
        poll.onLoad();
        const last = poll.src.value;

        setHidden(true);
        vi.advanceTimersByTime(30_000);
        setHidden(false);

        // Immediately, not 250 ms later: the picture on screen is 30 s old.
        expect(poll.src.value).not.toBe(last);
        poll.onLoad();
        expect(waitForNextRequest()).toBe(FRAME_INTERVAL_MS);
    });

    it('does not double up on a request that was still in flight', () => {
        const poll = polling();
        const inFlight = poll.src.value;

        setHidden(true);
        setHidden(false);

        expect(poll.src.value).toBe(inFlight);
        poll.onLoad();
        expect(waitForNextRequest()).toBe(FRAME_INTERVAL_MS);
    });

    it('asks for nothing at all when it is created on a hidden page', () => {
        hidden = true;

        const poll = polling();

        expect(poll.src.value).toBe('');
        expect(vi.getTimerCount()).toBe(0);

        setHidden(false);
        expect(poll.src.value).toBe(`${URL_A}&t=${Date.now()}`);
    });
});

describe('useCameraPoll — stopping', () => {
    it('leaves no timer behind when its scope is disposed', () => {
        const poll = polling();
        poll.onLoad();
        expect(vi.getTimerCount()).toBe(1);

        scope.stop();

        expect(vi.getTimerCount()).toBe(0);
    });

    it('ignores events that arrive after the scope is gone', () => {
        // Navigating away unmounts the view, but the request it left in flight
        // still resolves — into a composable nobody is watching.
        const poll = polling();
        const last = poll.src.value;
        scope.stop();

        poll.onError();
        poll.onLoad();

        expect(vi.getTimerCount()).toBe(0);
        expect(poll.src.value).toBe(last);
    });

    it('stops listening for visibility changes', () => {
        const poll = polling();
        poll.onLoad();
        const last = poll.src.value;
        scope.stop();

        setHidden(true);
        setHidden(false);

        expect(poll.src.value).toBe(last);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('useCameraPoll — a reactive URL', () => {
    it('switches cameras without waiting for the current chain', async () => {
        // /security/0 → /security/1 reuses the view, so only the URL changes.
        const cameraId = ref('camera_1');
        const poll = polling(() => `/api?id=${cameraId.value}`);
        poll.onLoad();

        cameraId.value = 'camera_2';
        await nextTick();

        expect(poll.src.value.startsWith('/api?id=camera_2&t=')).toBe(true);
        // The picture on screen belongs to the previous camera.
        expect(poll.loaded.value).toBe(false);
    });

    it('clears a failing camera’s error state when the URL changes', async () => {
        const cameraId = ref('camera_1');
        const poll = polling(() => `/api?id=${cameraId.value}`);
        for (let attempt = 0; attempt < ERROR_LIMIT; attempt += 1) {
            poll.onError();
            waitForNextRequest();
        }
        expect(poll.error.value).toBe(true);

        cameraId.value = 'camera_2';
        await nextTick();

        expect(poll.error.value).toBe(false);
        poll.onError();
        expect(waitForNextRequest()).toBe(BACKOFF_MIN_MS);
    });
});
