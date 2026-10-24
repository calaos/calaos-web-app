// Auth store — credentials (in memory only, never persisted) and the login
// state machine.
//
//   idle ──signIn()──▶ pending ──login success──▶ authed
//                        │                          │
//                        └──login failure──▶ failed │
//   idle ◀───────────────── signOut() ──────────────┘
//
// Deliberate fixes vs the old app (src/scripts/services.js):
//  - The socket NEVER logs in on its own. `resumeSession()` is a no-op unless
//    credentials are actually held, so a cold page load sends ZERO login
//    frames; the old ws.onopen unconditionally sent {cn_user:'',cn_pass:''}
//    which the server rejected — that is the login form shaking on load.
//  - A websocket error/close does not touch this store at all (the old
//    ws.onerror called signOut() + $state.go('login')).
//  - `signOut()` empties the home store, IO map included (the old ioCache
//    survived sign-out).
//
// Navigation: the router does not exist yet (T06) and this store must not
// import vue-router, so navigation is exposed as INTENT STATE —
// `pendingNavigation` plus `consumeNavigation()`. See the comment on
// `pendingNavigation` for the T06 contract.

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { encodeLogin } from '../protocol/messages';
import { useAdminStore } from './admin';
import { useAdminAlertsStore } from './adminAlerts';
import { useAudioStore } from './audio';
import { useHomeStore } from './home';

export type AuthState = 'idle' | 'pending' | 'authed' | 'failed';

/** Where the app wants to go next; consumed by the T06 router. */
export type NavigationIntent = 'home' | 'login';

/** See stores/home.ts — same contract, declared locally to avoid a cycle. */
export type FrameSender = (frame: string) => boolean;

export const useAuthStore = defineStore('auth', () => {
    // In memory only, exactly like the old app: no localStorage, no cookie.
    // services/camera-url.ts (T15) is the only other place they are read.
    const user = ref('');
    const pass = ref('');
    const state = ref<AuthState>('idle');

    /**
     * Set to 'home' once the house data of an INTERACTIVE sign-in has landed,
     * and to 'login' by signOut(). The T06 router watches it and calls
     * `consumeNavigation()`; nothing else clears it.
     *
     * It stays null for the re-login that follows a reconnect, on purpose: a
     * user reading a room must not be yanked back to /home because the
     * connection blinked.
     */
    const pendingNavigation = ref<NavigationIntent | null>(null);

    // Not state: the socket sender (injected by the service) and the flag
    // telling apart a user-initiated sign-in from a reconnect re-login.
    let send: FrameSender = () => {
        console.warn('calaos auth: no transport attached, dropping frame');
        return false;
    };
    let interactive = false;
    // A re-login with NEW credentials on a live session (after change_cred):
    // the one case where a login answer must be read while already 'authed'.
    let rotating = false;

    const isAuthed = computed(() => state.value === 'authed');
    const isPending = computed(() => state.value === 'pending');
    const hasFailed = computed(() => state.value === 'failed');
    /** The guard that kills the old empty-credential auto-login. */
    const hasCredentials = computed(() => user.value !== '' && pass.value !== '');

    /** Called once by services/calaos.ts with the socket's send(). */
    function attachTransport(sender: FrameSender): void {
        send = sender;
    }

    function sendLogin(): boolean {
        return send(encodeLogin(user.value, pass.value));
    }

    /**
     * User-initiated sign-in. Returns false when the frame could not be sent
     * (socket not open): the state stays 'pending' and the credentials are
     * retained, so the login goes out from `resumeSession()` as soon as the
     * socket opens.
     */
    function signIn(nextUser: string, nextPass: string): boolean {
        user.value = nextUser;
        pass.value = nextPass;
        // Clears a previous 'failed' — retrying after a typo must work.
        state.value = 'pending';
        interactive = true;
        return sendLogin();
    }

    /**
     * Called by services/calaos.ts on EVERY socket 'open' (first connect and
     * reconnects alike). Sends a login frame only when
     *   - credentials are held (never on a cold load), and
     *   - the last attempt was not rejected by the server (no login storm
     *     against a server that just said no).
     * Returns true when a frame was sent.
     */
    function resumeSession(): boolean {
        if (state.value === 'failed') return false;
        if (!hasCredentials.value) return false;
        // `interactive` is deliberately left alone: a sign-in submitted while
        // the socket was still connecting is still the user's, and must still
        // navigate once the house data arrives.
        // A credential rotation cut short by the drop is now this login.
        rotating = false;
        state.value = 'pending';
        return sendLogin();
    }

    /**
     * The household password was just changed through `settings` /
     * `change_cred`: the server dropped its `loggedin` flag but the socket
     * is still open, so the new credentials go out on it at once. The state
     * stays 'authed' — the chrome must not blink — and a refusal is handled
     * like a refused re-login (the router sends the user to /login).
     */
    function rotateCredentials(nextUser: string, nextPass: string): boolean {
        user.value = nextUser;
        pass.value = nextPass;
        rotating = true;
        return sendLogin();
    }

    /** Called by services/calaos.ts for every decoded login answer. */
    function handleLoginResult(success: boolean): void {
        if (rotating) {
            rotating = false;
            state.value = success ? 'authed' : 'failed';
            if (!success) interactive = false;
            return;
        }
        if (state.value === 'authed') {
            // Old code ignored login frames while already authenticated
            // (`obj.msg == 'login' && !auth`); a stray failure must not log
            // an active session out.
            console.debug('calaos auth: login answer while already authed, ignored');
            return;
        }
        if (success) {
            state.value = 'authed';
            return;
        }
        // No navigation intent is raised here: a rejection leaves the user
        // where they are (the login form shows the error). If a re-login
        // after a reconnect is ever rejected mid-session, T06/T07 can decide
        // to raise 'login' from the router side — it is a UX call, not a
        // protocol one.
        state.value = 'failed';
        interactive = false;
    }

    /**
     * Called by services/calaos.ts once the home store has ingested the
     * get_home that followed a login. Raises the 'home' navigation intent for
     * interactive sign-ins only.
     */
    function notifyHomeLoaded(): void {
        if (!interactive) return;
        interactive = false;
        pendingNavigation.value = 'home';
    }

    /** Reads and clears the intent — the T06 router is the only caller. */
    function consumeNavigation(): NavigationIntent | null {
        const intent = pendingNavigation.value;
        pendingNavigation.value = null;
        return intent;
    }

    /**
     * Drops the credentials and the house data and asks for /login. The
     * socket stays OPEN and connected (signing out is not a network event);
     * the next signIn() reuses it.
     */
    function signOut(): void {
        useHomeStore().clear();
        // Same reason the home store is emptied: what one account was
        // listening to is not the next account's business, and a cover reply
        // still in flight must not attach artwork to a new session's player.
        useAudioStore().clear();
        // The admin session belongs to the account that unlocked it.
        useAdminStore().reset();
        useAdminAlertsStore().reset();
        user.value = '';
        pass.value = '';
        state.value = 'idle';
        interactive = false;
        rotating = false;
        pendingNavigation.value = 'login';
    }

    return {
        user,
        pass,
        state,
        pendingNavigation,
        isAuthed,
        isPending,
        hasFailed,
        hasCredentials,
        attachTransport,
        signIn,
        resumeSession,
        rotateCredentials,
        handleLoginResult,
        notifyHomeLoaded,
        consumeNavigation,
        signOut,
    };
});
