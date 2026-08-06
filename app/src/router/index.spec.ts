import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory } from 'vue-router';
import { createAppRouter, startNavigationIntents } from './index';
import { toHomeData } from '../protocol/guards';
import { useAuthStore } from '../stores/auth';
import { useHomeStore } from '../stores/home';
import type { Router } from 'vue-router';

/** Two rooms, two cameras — so index 1 is valid and index 2 never is. */
function loadHouse(): void {
    useHomeStore().setHome(
        toHomeData({
            home: [
                { name: 'Salon', type: 'lounge', hits: '10', items: [] },
                { name: 'Cuisine', type: 'kitchen', hits: '5', items: [] },
            ],
            cameras: [
                { id: 'cam_1', name: 'Entrée' },
                { id: 'cam_2', name: 'Jardin' },
            ],
            audio: [{ id: 'audio_1', name: 'Salon' }],
        }),
    );
}

function signedIn(): void {
    // The state machine's own transitions are covered in stores/auth.spec.ts;
    // here only the guard's view of it matters.
    useAuthStore().state = 'authed';
}

let router: Router;

beforeEach(() => {
    setActivePinia(createPinia());
    router = createAppRouter(createMemoryHistory());
});

describe('routes', () => {
    it('declares hash-history-safe paths with the expected meta', async () => {
        signedIn();
        loadHouse();

        await router.push('/home/1');
        expect(router.currentRoute.value.name).toBe('room');
        expect(router.currentRoute.value.meta.requiresAuth).toBe(true);
        expect(router.currentRoute.value.meta.detail).toBe(true);

        await router.push('/audio');
        expect(router.currentRoute.value.meta.requiresAuth).toBe(true);
        expect(router.currentRoute.value.meta.detail).toBeUndefined();
    });

    it('accepts an opaque (non-numeric) audio player id', async () => {
        signedIn();

        await router.push('/audio/zone-kitchen');
        expect(router.currentRoute.value.name).toBe('audioPlayer');
        expect(router.currentRoute.value.params.playerId).toBe('zone-kitchen');
    });

    it('sends / and unknown paths to home', async () => {
        signedIn();

        await router.push('/');
        expect(router.currentRoute.value.name).toBe('home');

        await router.push('/nope/nope');
        expect(router.currentRoute.value.name).toBe('home');
    });

    it('defaults to hash history, and guards the hash URL', async () => {
        // Deep links must survive a reload on calaos_server / a static file
        // server, neither of which has an SPA fallback — hence the hash.
        // Built with no injected history, i.e. exactly what main.ts builds.
        const hashRouter = createAppRouter();

        await hashRouter.push('/home/1');

        expect(window.location.hash).toBe('#/login');
    });

    it('leaves login reachable without meta.requiresAuth', async () => {
        await router.push('/login');
        expect(router.currentRoute.value.name).toBe('login');
        expect(router.currentRoute.value.meta.requiresAuth).toBeUndefined();
    });
});

describe('auth guard', () => {
    it.each([['/home'], ['/home/0'], ['/audio'], ['/audio/1'], ['/security'], ['/security/0']])(
        'redirects %s to /login when not authenticated',
        async (path) => {
            await router.push(path);
            expect(router.currentRoute.value.path).toBe('/login');
        },
    );

    it('lets an authenticated user through', async () => {
        signedIn();
        loadHouse();

        await router.push('/security/1');
        expect(router.currentRoute.value.path).toBe('/security/1');
    });

    it('sends an authenticated user away from the login form', async () => {
        signedIn();

        await router.push('/login');

        expect(router.currentRoute.value.path).toBe('/home');
    });

    it('keeps the login form reachable while a sign-in is still pending', async () => {
        useAuthStore().state = 'pending';

        await router.push('/login');

        expect(router.currentRoute.value.path).toBe('/login');
    });

    it('redirects again once the user signs out', async () => {
        signedIn();
        await router.push('/home');
        expect(router.currentRoute.value.path).toBe('/home');

        useAuthStore().signOut();
        // A different route on purpose: re-pushing the current location is a
        // duplicated navigation, which never reaches a guard.
        await router.push('/security');
        expect(router.currentRoute.value.path).toBe('/login');
    });
});

describe('out-of-bounds index params', () => {
    beforeEach(() => {
        signedIn();
        loadHouse();
    });

    it('redirects an unknown roomId to the room list', async () => {
        await router.push('/home/2');
        expect(router.currentRoute.value.name).toBe('home');
        expect(router.currentRoute.value.path).toBe('/home');
    });

    it('redirects an unknown cameraId to the camera list', async () => {
        await router.push('/security/7');
        expect(router.currentRoute.value.name).toBe('security');
        expect(router.currentRoute.value.path).toBe('/security');
    });

    it('accepts the last valid index of each list', async () => {
        await router.push('/home/1');
        expect(router.currentRoute.value.path).toBe('/home/1');

        await router.push('/security/1');
        expect(router.currentRoute.value.path).toBe('/security/1');
    });

    it('redirects every detail route while the house is still empty', async () => {
        useHomeStore().clear();

        await router.push('/home/0');
        expect(router.currentRoute.value.path).toBe('/home');

        await router.push('/security/0');
        expect(router.currentRoute.value.path).toBe('/security');
    });
});

describe('navigation intents', () => {
    let stop: () => void;

    afterEach(() => {
        stop?.();
    });

    it('pushes and clears the intent raised after a sign-in', async () => {
        stop = startNavigationIntents(router);
        const auth = useAuthStore();

        await router.push('/login');
        signedIn();
        auth.pendingNavigation = 'home';
        await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('home'));

        expect(auth.pendingNavigation).toBeNull();
    });

    it('pushes /login when signOut raises the intent', async () => {
        stop = startNavigationIntents(router);
        const auth = useAuthStore();

        signedIn();
        await router.push('/home');

        auth.signOut();
        await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/login'));
        expect(auth.pendingNavigation).toBeNull();
    });

    it('ignores a cleared intent', async () => {
        stop = startNavigationIntents(router);
        signedIn();
        await router.push('/home');

        useAuthStore().pendingNavigation = null;
        await Promise.resolve();

        expect(router.currentRoute.value.path).toBe('/home');
    });

    it('sends the user back to login when a re-login is refused mid-session', async () => {
        // The reconnect case: the tablet wakes up, resumeSession() re-logs in
        // and the server says no. The store raises no intent for this (it is
        // a UX call), so this watcher is the whole behaviour.
        stop = startNavigationIntents(router);
        const auth = useAuthStore();
        signedIn();
        loadHouse();
        await router.push('/home/1');

        auth.state = 'failed';
        await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/login'));

        // Still 'failed', which is what makes LoginView show the error.
        expect(auth.hasFailed).toBe(true);
    });

    it('does not re-navigate when a sign-in is refused on the login form', async () => {
        stop = startNavigationIntents(router);
        const auth = useAuthStore();
        await router.push('/login');
        const before = router.currentRoute.value.fullPath;

        auth.state = 'failed';
        await Promise.resolve();

        expect(router.currentRoute.value.fullPath).toBe(before);
    });
});
