// Router — hash history, auth guard, out-of-bounds param guard, and the
// bridge that turns the auth store's navigation INTENTS into real pushes.
//
// Hash history (docs/ARCHITECTURE.md "Router"): the app is served by
// calaos_server or a dumb static server, neither of which has an SPA
// fallback, so `/#/home/3` must survive a reload.
//
// The guard reads the stores lazily (inside the callback), so this module can
// be imported before `app.use(createPinia())`.

import { defineComponent, h, watch } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import type { WatchStopHandle } from 'vue';
import type { Router, RouterHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useHomeStore } from '../stores/home';

declare module 'vue-router' {
    interface RouteMeta {
        /** Route is only reachable once the auth store says `authed`. */
        requiresAuth?: boolean;
        /** Detail route: NavBar shows the back button (old `canGoBack()`). */
        detail?: boolean;
    }
}

/**
 * Scaffolding for the views that land in T07–T18. Each one is a single line
 * to delete: swap the placeholder for the real `views/*.vue` import.
 * The rendered text is a route id, not UI copy — it is never translated
 * because it never ships.
 */
function placeholderView(routeName: string) {
    return defineComponent({
        name: `${routeName}Placeholder`,
        setup() {
            // Styled inline rather than in styles/*.css: scaffolding should
            // leave nothing behind when these lines are deleted.
            return () =>
                h(
                    'div',
                    {
                        class: 'route-placeholder',
                        style: {
                            display: 'grid',
                            placeItems: 'center',
                            minHeight: '100%',
                            padding: '2rem',
                            color: 'var(--c-text-muted)',
                        },
                    },
                    routeName,
                );
        },
    });
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
                path: '/login',
                name: 'login',
                // T07 replaces this with views/LoginView.vue.
                component: placeholderView('login'),
            },
            {
                path: '/home',
                name: 'home',
                component: placeholderView('home'),
                meta: { requiresAuth: true },
            },
            {
                path: '/home/:roomId(\\d+)',
                name: 'room',
                component: placeholderView('room'),
                meta: { requiresAuth: true, detail: true },
            },
            {
                path: '/audio',
                name: 'audio',
                component: placeholderView('audio'),
                meta: { requiresAuth: true },
            },
            {
                // No \d+ constraint, unlike rooms and cameras: the real audio
                // protocol (T16) may key players by id string, so this param
                // is opaque and gets no bounds check.
                path: '/audio/:playerId',
                name: 'audioPlayer',
                component: placeholderView('audioPlayer'),
                meta: { requiresAuth: true, detail: true },
            },
            {
                path: '/security',
                name: 'security',
                component: placeholderView('security'),
                meta: { requiresAuth: true },
            },
            {
                path: '/security/:cameraId(\\d+)',
                name: 'camera',
                component: placeholderView('camera'),
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
 * Wires `auth.pendingNavigation` to the router. The auth store cannot import
 * vue-router (it would make stores↔router a cycle and break store unit
 * tests), so it raises an intent and this watcher performs the push.
 *
 * Returns the watch handle; main.ts ignores it (app lifetime), tests stop it.
 */
export function startNavigationIntents(router: Router): WatchStopHandle {
    const auth = useAuthStore();

    return watch(
        () => auth.pendingNavigation,
        (intent) => {
            if (intent === null) return;
            void router.push({ name: intent });
            auth.consumeNavigation();
        },
    );
}
