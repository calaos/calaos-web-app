// Router — hash history, auth guard, out-of-bounds param guard, and the
// bridge that turns the auth store's navigation INTENTS into real pushes.
//
// Hash history (docs/ARCHITECTURE.md "Router"): the app is served by
// calaos_server or a dumb static server, neither of which has an SPA
// fallback, so `/#/home/3` must survive a reload.
//
// The guard reads the stores lazily (inside the callback), so this module can
// be imported before `app.use(createPinia())`.

import { watch } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import type { WatchStopHandle } from 'vue';
import type { Router, RouterHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useHomeStore } from '../stores/home';
import AudioListView from '../views/AudioListView.vue';
import AudioPlayerView from '../views/AudioPlayerView.vue';
import CameraListView from '../views/CameraListView.vue';
import CameraView from '../views/CameraView.vue';
import HomeView from '../views/HomeView.vue';
import LoginView from '../views/LoginView.vue';
import RoomView from '../views/RoomView.vue';

declare module 'vue-router' {
    interface RouteMeta {
        /** Route is only reachable once the auth store says `authed`. */
        requiresAuth?: boolean;
        /** Detail route: NavBar shows the back button (old `canGoBack()`). */
        detail?: boolean;
    }
}

/**
 * Builds a fresh router. `history` is injectable so unit tests can drive a
 * memory history (same pattern as CalaosSocket's injectable WebSocket).
 */
export function createAppRouter(history: RouterHistory = createWebHashHistory()): Router {
    const router = createRouter({
        history,
        routes: [
            { path: '/', redirect: { name: 'home' } },
            {
                // Eagerly imported, not lazy: it is the first thing an
                // unauthenticated visitor sees, so a second round trip for
                // its chunk would only add a blank frame.
                path: '/login',
                name: 'login',
                component: LoginView,
            },
            {
                // Eager, like LoginView: /home is where every sign-in lands
                // and where the footer's Home tab always goes, so a lazy
                // chunk would only add a blank frame to the app's busiest
                // route. Same for the room it opens.
                path: '/home',
                name: 'home',
                component: HomeView,
                meta: { requiresAuth: true },
            },
            {
                path: '/home/:roomId(\\d+)',
                name: 'room',
                component: RoomView,
                meta: { requiresAuth: true, detail: true },
            },
            {
                path: '/audio',
                name: 'audio',
                component: AudioListView,
                meta: { requiresAuth: true },
            },
            {
                // No \d+ constraint, unlike rooms and cameras: T16 confirmed
                // players ARE keyed by id string (`audio_1`), and T17 routes
                // by that id rather than by list position — the audio list is
                // unsorted and a house can gain a player, either of which
                // would silently repoint a bookmarked index at someone else's
                // player. The param stays opaque and gets no bounds check;
                // AudioPlayerView renders nothing when no player matches.
                path: '/audio/:playerId',
                name: 'audioPlayer',
                component: AudioPlayerView,
                meta: { requiresAuth: true, detail: true },
            },
            {
                // Eager, like the home routes: the Security tab is one press
                // away at all times, and a lazy chunk would put a blank frame
                // in front of a screen whose entire job is to show pictures
                // quickly.
                path: '/security',
                name: 'security',
                component: CameraListView,
                meta: { requiresAuth: true },
            },
            {
                path: '/security/:cameraId(\\d+)',
                name: 'camera',
                component: CameraView,
                meta: { requiresAuth: true, detail: true },
            },
            // Unknown hash → home, where the auth guard takes over.
            { path: '/:pathMatch(.*)*', redirect: { name: 'home' } },
        ],
    });

    router.beforeEach((to) => {
        const auth = useAuthStore();

        if (to.meta.requiresAuth && !auth.isAuthed) {
            return { name: 'login' };
        }

        // The mirror of the rule above: a signed-in user who types /#/login
        // (or reloads on it after signing in on another tab) has no business
        // on a form they have already filled in. The old app had no such
        // rule and happily rendered the login screen over a live session.
        if (to.name === 'login' && auth.isAuthed) {
            return { name: 'home' };
        }

        // Bounds check for the index-based params. `roomId`/`cameraId` are
        // positions in the hits-sorted room list / camera list, so a stale
        // deep link (or a smaller house after a re-login) must land on the
        // list instead of rendering an empty detail view. An unloaded house
        // (count 0) redirects too — the list view then shows its own empty
        // state.
        const home = useHomeStore();

        if (typeof to.params.roomId === 'string' && !inBounds(to.params.roomId, home.roomCount)) {
            return { name: 'home' };
        }

        if (
            typeof to.params.cameraId === 'string' &&
            !inBounds(to.params.cameraId, home.cameraCount)
        ) {
            return { name: 'security' };
        }

        return true;
    });

    return router;
}

/** `\d+` already excludes signs and decimals; this only checks the range. */
function inBounds(rawIndex: string, count: number): boolean {
    const index = Number(rawIndex);
    return Number.isInteger(index) && index >= 0 && index < count;
}

/**
 * Wires the auth store to the router. The store cannot import vue-router (it
 * would make stores↔router a cycle and break store unit tests), so everything
 * it wants from navigation is expressed as state and performed here.
 *
 * Two watchers:
 *  1. `pendingNavigation` — the intent raised by an interactive sign-in
 *    (→ /home, once the house data has landed) and by signOut() (→ /login).
 *  2. a rejected re-login mid-session. `resumeSession()` fires on every
 *    reconnect, and the server can refuse it (the password changed while the
 *    tablet was asleep). The store deliberately raises no intent for that —
 *    it is a UX call, not a protocol one, and this is the call: a session
 *    that is no longer valid must not leave the user staring at stale rooms
 *    whose controls silently do nothing. LoginView renders the error on
 *    arrival because `state` is still 'failed'.
 *
 * Returns one handle stopping both; main.ts ignores it (app lifetime), tests
 * stop it.
 */
export function startNavigationIntents(router: Router): WatchStopHandle {
    const auth = useAuthStore();

    const stopIntents = watch(
        () => auth.pendingNavigation,
        (intent) => {
            if (intent === null) return;
            void router.push({ name: intent });
            auth.consumeNavigation();
        },
    );

    const stopRejections = watch(
        () => auth.hasFailed,
        (failed) => {
            if (!failed) return;
            // Only from behind the auth wall. A refusal while the user is
            // already on /login is the ordinary wrong-password case, and
            // pushing the route they are on would be a no-op navigation.
            if (router.currentRoute.value.meta.requiresAuth !== true) return;
            void router.push({ name: 'login' });
        },
    );

    return () => {
        stopIntents();
        stopRejections();
    };
}
