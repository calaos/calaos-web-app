// Playwright — the E2E rig for the Vue app (docs/ARCHITECTURE.md "Testing
// strategy").
//
// Two deliberate choices, both of which the specs depend on:
//
// 1. The app under test is the BUILT bundle behind `vite preview`, never the
//    dev server. Production is a static bundle served by calaos_server, and
//    the WebSocket URL is derived from `window.location` (protocol/server-url
//    .ts). Testing the dev server would exercise a URL derivation that never
//    ships. `preview` also proxies `/api` (ws + http) to the mock, which is
//    exactly what calaos_server does for the real app.
//
// 2. `build` is part of the webServer command. `vite preview` serves whatever
//    is in dist-next at the moment it starts, so a preview launched without a
//    fresh build would happily serve a stale bundle and pass.

import { defineConfig, devices } from '@playwright/test';

/** Mock calaos_server (mock-server/index.mjs). Its PORT env default. */
const MOCK_PORT = 5454;
/** `vite preview` for the built app. */
const APP_PORT = 4173;

export default defineConfig({
    testDir: './e2e',

    // ONE mock server is shared by the whole run, and the specs drive it
    // globally: `{op:'reset'}` wipes the frame log for everyone and
    // `{op:'drop'}` kills every open socket, including sockets belonging to
    // another worker's page. Parallelism here would not be flaky, it would be
    // wrong. The suite is small enough that serial costs under a minute.
    fullyParallel: false,
    workers: 1,

    forbidOnly: !!process.env.CI,
    // The reconnect spec waits on real backoff timers; one retry absorbs a
    // loaded CI box without hiding a genuine regression (a broken reconnect
    // fails both times).
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

    // Generous relative to the specs (the slowest is ~6 s of real backoff),
    // because the first navigation of a project also pays font/bundle load.
    timeout: 30_000,
    expect: { timeout: 10_000 },

    use: {
        baseURL: `http://localhost:${APP_PORT}`,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'off',
    },

    projects: [
        // Both are chromium (`devices[...].defaultBrowserType`), so the run
        // needs only `npx playwright install chromium`. The mobile project is
        // not a viewport tweak: `isMobile`/`hasTouch` change hit-testing and
        // the `100dvh` shell in App.vue, which is where a phone-only layout
        // bug would surface.
        { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
        { name: 'mobile-pixel7', use: { ...devices['Pixel 7'] } },
    ],

    webServer: [
        {
            command: 'npm run mock',
            // GET /control is a side-effect-free status snapshot, which is
            // why control.mjs advertises it as the readiness probe. Probing
            // `/api` would open a WebSocket the mock would then log.
            url: `http://localhost:${MOCK_PORT}/control`,
            // Never adopt a mock left running by `npm run dev:next`: its frame
            // log and scenario state are unknown, and the cold-load spec
            // asserts on an empty log.
            reuseExistingServer: false,
            timeout: 30_000,
            stdout: 'ignore',
            stderr: 'pipe',
        },
        {
            command: `npm run build:next && npm run preview:next -- --port ${APP_PORT} --strictPort`,
            url: `http://localhost:${APP_PORT}/`,
            // Same reason as the mock, plus the one above: reusing a preview
            // would skip the build in front of it.
            reuseExistingServer: false,
            // Covers a cold `vite build` on a slow machine.
            timeout: 120_000,
            stdout: 'ignore',
            stderr: 'pipe',
        },
    ],
});
