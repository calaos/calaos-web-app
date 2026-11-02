// The capture token that authorises camera snapshot URLs
// (calaos_base docs/08_http_api.md, "jeton de capture").
//
// An `<img>` cannot send a header, so whatever authorises a snapshot ends up
// in its URL, and from there in proxy logs and browser history. The live
// WebSocket session hands out a short-lived token for that instead of the
// household password: it only opens camera snapshots, dies with the session
// that obtained it, and is renewed here before it expires so the picture on
// screen never goes blank for it.
//
// A token is only asked for while a camera is on screen (`acquire`/`release`)
// and the household session is authed; it is exposed only while authed, so a
// refused login stops every snapshot at once, before the next frame is asked.

import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { encodeCameraToken } from '../protocol/messages';
import type { CameraTokenMessage } from '../protocol/types';
import type { FrameSender } from './admin';
import { useAuthStore } from './auth';

const MSG_ID_PREFIX = 'camera_token:';
/** Renew this long before expiry, so a slow round trip still lands in time. */
export const RENEW_MARGIN_S = 30;
/**
 * Bounds of a server-given lifetime. The floor is low on purpose: the camera
 * e2e specs use a 2 s ttl and a higher one would break their renewal timing.
 * The real server issues 120 s.
 */
export const MIN_LIFETIME_S = 1;
export const MAX_LIFETIME_S = 3600;
/** A request with no answer by then is given up and retried. */
export const REPLY_TIMEOUT_MS = 5000;
export const RETRY_MIN_MS = 1000;
export const RETRY_MAX_MS = 30_000;

export const useCameraTokenStore = defineStore('cameraToken', () => {
    const auth = useAuthStore();
    const current = ref('');

    let send: FrameSender = () => false;
    let seq = 0;
    /** msg_id of the request in flight; any other answer is stale. */
    let pending: string | null = null;
    let consumers = 0;
    let expiresAt = 0;
    let retryMs = RETRY_MIN_MS;
    let nextTimer: ReturnType<typeof setTimeout> | null = null;
    let replyTimer: ReturnType<typeof setTimeout> | null = null;
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;

    /** '' when there is no usable token: callers must then send nothing. */
    const token = computed(() => (auth.isAuthed ? current.value : ''));

    function attachTransport(sender: FrameSender): void {
        send = sender;
    }

    function clear(timer: ReturnType<typeof setTimeout> | null): null {
        if (timer !== null) clearTimeout(timer);
        return null;
    }

    function wanted(): boolean {
        return consumers > 0 && auth.isAuthed;
    }

    function scheduleNext(delayMs: number): void {
        nextTimer = clear(nextTimer);
        nextTimer = setTimeout(() => {
            nextTimer = null;
            request();
        }, delayMs);
    }

    function retryLater(): void {
        const delayMs = retryMs;
        retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
        if (wanted()) scheduleNext(delayMs);
    }

    function request(): void {
        if (!wanted() || pending !== null) return;
        const msgId = `${MSG_ID_PREFIX}${++seq}`;
        if (!send(encodeCameraToken(msgId))) {
            retryLater();
            return;
        }
        pending = msgId;
        replyTimer = setTimeout(() => {
            replyTimer = null;
            pending = null;
            retryLater();
        }, REPLY_TIMEOUT_MS);
    }

    /** Asks now if there is no token, otherwise makes sure its renewal is due. */
    function ensure(): void {
        if (!wanted() || pending !== null || nextTimer !== null) return;
        if (current.value === '') {
            request();
            return;
        }
        scheduleNext(Math.max(0, expiresAt - RENEW_MARGIN_S * 1000 - Date.now()));
    }

    function handleReply(msg: CameraTokenMessage): void {
        if (pending === null || msg.msgId !== pending) return;
        pending = null;
        replyTimer = clear(replyTimer);
        if (msg.token === '' || msg.expiresIn === null) {
            // Only trace of a server without camera_token support; msg.error is
            // server text, never the token.
            console.warn('calaos camera: no capture token', msg.error);
            retryLater();
            return;
        }

        // A hostile or buggy server must not overflow setTimeout (2^31 ms) or
        // make us renew at round-trip speed.
        const lifetimeMs = Math.min(Math.max(msg.expiresIn, MIN_LIFETIME_S), MAX_LIFETIME_S) * 1000;
        current.value = msg.token;
        expiresAt = Date.now() + lifetimeMs;
        retryMs = RETRY_MIN_MS;
        expiryTimer = clear(expiryTimer);
        expiryTimer = setTimeout(() => {
            expiryTimer = null;
            current.value = '';
        }, lifetimeMs);
        // Short lifetimes still renew halfway, never right on top of expiry.
        const renewMs = Math.max(lifetimeMs - RENEW_MARGIN_S * 1000, lifetimeMs / 2);
        if (wanted()) scheduleNext(renewMs);
    }

    /** A camera frame went on screen. */
    function acquire(): void {
        consumers += 1;
        ensure();
    }

    /** A camera frame left the screen; the token is kept until it expires. */
    function release(): void {
        consumers = Math.max(0, consumers - 1);
        if (consumers === 0) nextTimer = clear(nextTimer);
    }

    /** The server dropped the token: socket closed, or credentials changed. */
    function invalidate(): void {
        current.value = '';
        expiresAt = 0;
        pending = null;
        retryMs = RETRY_MIN_MS;
        nextTimer = clear(nextTimer);
        replyTimer = clear(replyTimer);
        expiryTimer = clear(expiryTimer);
    }

    /**
     * A login succeeded. Any token held belongs to the previous session (a
     * reconnect or a credential change revoked it server-side), so a fresh
     * one is asked for.
     */
    function handleLoggedIn(): void {
        invalidate();
        ensure();
    }

    // Sign-out and a refused re-login: synchronous, so no frame scheduled in
    // the same tick can still pick the token up.
    watch(
        () => auth.isAuthed,
        (authed) => {
            if (!authed) invalidate();
        },
        { flush: 'sync' },
    );

    return {
        token,
        attachTransport,
        acquire,
        release,
        handleReply,
        handleLoggedIn,
        invalidate,
    };
});
