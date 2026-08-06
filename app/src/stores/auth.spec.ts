import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAuthStore } from './auth';
import { useHomeStore } from './home';
import { toHomeData } from '../protocol/guards';

const LOGIN_FRAME = '{"msg":"login","data":{"cn_user":"demo","cn_pass":"s3cret"}}';

let sent: string[];
let canSend: boolean;

function makeStore(): ReturnType<typeof useAuthStore> {
    const store = useAuthStore();
    store.attachTransport((frame) => {
        if (!canSend) return false;
        sent.push(frame);
        return true;
    });
    return store;
}

/** Signs in and answers with a successful login + home data. */
function completeSignIn(store: ReturnType<typeof useAuthStore>): void {
    store.signIn('demo', 's3cret');
    store.handleLoginResult(true);
    useHomeStore().setHome(
        toHomeData({
            home: [
                {
                    name: 'Salon',
                    type: 'lounge',
                    hits: '1',
                    items: [
                        {
                            id: 'light_1',
                            name: 'Plafonnier',
                            gui_type: 'light',
                            state: 'true',
                            visible: 'true',
                            rw: 'true',
                            unit: '',
                        },
                    ],
                },
            ],
            cameras: [{ id: 'camera_1', name: 'Entrée' }],
            audio: [{ id: 'audio_1', name: 'Salon' }],
        }),
    );
    store.notifyHomeLoaded();
}

beforeEach(() => {
    setActivePinia(createPinia());
    sent = [];
    canSend = true;
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('auth machine', () => {
    it('starts idle with no credentials and sends nothing', () => {
        const store = makeStore();

        expect(store.state).toBe('idle');
        expect(store.user).toBe('');
        expect(store.pass).toBe('');
        expect(store.hasCredentials).toBe(false);
        expect(store.isAuthed).toBe(false);
        expect(sent).toEqual([]);
    });

    it('signIn stores the credentials, goes pending and sends the login frame', () => {
        const store = makeStore();

        expect(store.signIn('demo', 's3cret')).toBe(true);

        expect(store.state).toBe('pending');
        expect(store.isPending).toBe(true);
        expect(store.hasCredentials).toBe(true);
        expect(sent).toEqual([LOGIN_FRAME]);
    });

    it('pending → authed on success', () => {
        const store = makeStore();
        store.signIn('demo', 's3cret');

        store.handleLoginResult(true);

        expect(store.state).toBe('authed');
        expect(store.isAuthed).toBe(true);
        expect(store.hasFailed).toBe(false);
    });

    it('pending → failed on rejection, credentials retained for a retry', () => {
        const store = makeStore();
        store.signIn('demo', 's3cret');

        store.handleLoginResult(false);

        expect(store.state).toBe('failed');
        expect(store.hasFailed).toBe(true);
        expect(store.isAuthed).toBe(false);
    });

    it('retrying after a rejection leaves the failed state and sends again', () => {
        const store = makeStore();
        store.signIn('demo', 'wrong');
        store.handleLoginResult(false);

        expect(store.signIn('demo', 's3cret')).toBe(true);

        expect(store.state).toBe('pending');
        expect(sent).toEqual([
            '{"msg":"login","data":{"cn_user":"demo","cn_pass":"wrong"}}',
            LOGIN_FRAME,
        ]);
    });

    it('ignores a login answer that arrives while already authed', () => {
        const store = makeStore();
        store.signIn('demo', 's3cret');
        store.handleLoginResult(true);

        store.handleLoginResult(false);

        expect(store.state).toBe('authed');
    });

    it('keeps the credentials and stays pending when the frame cannot be sent', () => {
        const store = makeStore();
        canSend = false;

        expect(store.signIn('demo', 's3cret')).toBe(false);

        expect(store.state).toBe('pending');
        expect(store.hasCredentials).toBe(true);
        expect(sent).toEqual([]);
    });

    it('warns and reports failure when no transport is attached', () => {
        const store = useAuthStore();

        expect(store.signIn('demo', 's3cret')).toBe(false);
        expect(console.warn).toHaveBeenCalled();
    });
});

describe('resumeSession — login on socket open', () => {
    // The regression that made the old login form shake on every cold load.
    it('sends ZERO login frames when no credentials are held', () => {
        const store = makeStore();

        expect(store.resumeSession()).toBe(false);

        expect(sent).toEqual([]);
        expect(store.state).toBe('idle');
    });

    it('sends nothing when only one field was filled in', () => {
        const store = makeStore();
        store.signIn('demo', '');
        sent = [];

        expect(store.resumeSession()).toBe(false);
        expect(sent).toEqual([]);
    });

    it('re-logs in with retained credentials after a reconnect', () => {
        const store = makeStore();
        completeSignIn(store);
        sent = [];

        expect(store.resumeSession()).toBe(true);

        expect(sent).toEqual([LOGIN_FRAME]);
        expect(store.state).toBe('pending');
    });

    it('never re-logs in after an explicit rejection', () => {
        const store = makeStore();
        store.signIn('demo', 's3cret');
        store.handleLoginResult(false);
        sent = [];

        expect(store.resumeSession()).toBe(false);
        expect(store.resumeSession()).toBe(false);

        expect(sent).toEqual([]);
        expect(store.state).toBe('failed');
    });

    it('flushes a sign-in that was submitted before the socket was open', () => {
        const store = makeStore();
        canSend = false;
        store.signIn('demo', 's3cret');
        canSend = true;

        expect(store.resumeSession()).toBe(true);
        expect(sent).toEqual([LOGIN_FRAME]);
    });

    it('sends nothing after signOut cleared the credentials', () => {
        const store = makeStore();
        completeSignIn(store);
        store.signOut();
        sent = [];

        expect(store.resumeSession()).toBe(false);
        expect(sent).toEqual([]);
    });
});

describe('navigation intents (consumed by the T06 router)', () => {
    it('asks for /home once the house data of an interactive sign-in landed', () => {
        const store = makeStore();
        expect(store.pendingNavigation).toBeNull();

        store.signIn('demo', 's3cret');
        store.handleLoginResult(true);
        // Not before the data is in: the router would land on an empty house.
        expect(store.pendingNavigation).toBeNull();

        store.notifyHomeLoaded();
        expect(store.pendingNavigation).toBe('home');
    });

    it('consumeNavigation returns the intent once', () => {
        const store = makeStore();
        completeSignIn(store);

        expect(store.consumeNavigation()).toBe('home');
        expect(store.consumeNavigation()).toBeNull();
        expect(store.pendingNavigation).toBeNull();
    });

    it('does NOT navigate for the get_home that follows a reconnect re-login', () => {
        const store = makeStore();
        completeSignIn(store);
        store.consumeNavigation();

        store.resumeSession();
        store.handleLoginResult(true);
        store.notifyHomeLoaded();

        expect(store.pendingNavigation).toBeNull();
    });

    it('does not navigate after a rejected sign-in', () => {
        const store = makeStore();
        store.signIn('demo', 'wrong');
        store.handleLoginResult(false);
        store.notifyHomeLoaded();

        expect(store.pendingNavigation).toBeNull();
    });

    it('asks for /login on signOut', () => {
        const store = makeStore();
        completeSignIn(store);
        store.consumeNavigation();

        store.signOut();

        expect(store.pendingNavigation).toBe('login');
    });
});

describe('signOut', () => {
    it('clears the credentials, the state and the whole home store', () => {
        const store = makeStore();
        const home = useHomeStore();
        completeSignIn(store);
        expect(home.ios.size).toBe(1);

        store.signOut();

        expect(store.user).toBe('');
        expect(store.pass).toBe('');
        expect(store.state).toBe('idle');
        expect(store.hasCredentials).toBe(false);
        expect(store.isAuthed).toBe(false);

        // Old bug: homeData was blanked but ioCache kept every IO of the
        // previous session, so the next user's events patched stale objects.
        expect(home.ios.size).toBe(0);
        expect(home.rooms).toEqual([]);
        expect(home.cameras).toEqual([]);
        expect(home.audioPlayers).toEqual([]);
        expect(home.loaded).toBe(false);
    });

    it('does not touch the socket (no frame, no close)', () => {
        const store = makeStore();
        completeSignIn(store);
        sent = [];

        store.signOut();

        expect(sent).toEqual([]);
    });
});
