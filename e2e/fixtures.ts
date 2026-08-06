// Shared E2E vocabulary: the mock's `/control` API as a typed object, the
// demo credentials, the locators the specs agree on, and the two multi-step
// moves (sign in, record navigation) every spec needs.
//
// Import `test` and `expect` FROM HERE, not from `@playwright/test` — the
// `test` exported below carries the `mock` fixture.

import { test as base, expect } from '@playwright/test';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import en from '../app/src/i18n/en.json';

/**
 * The UI copy the specs assert on, read from the app's own catalogue so a
 * wording change is a one-file change. `navigator.language` decides the
 * locale (app/src/i18n/index.ts); the `chromium-desktop` and `mobile-pixel7`
 * projects both run under the default (english) locale, so `MESSAGES` is
 * `en` here. The `fr` project's own spec (e2e/fr-locale.spec.ts) imports
 * `fr.json` directly instead of importing from here.
 */
export const MESSAGES = en;

/** The mock's built-in account (mock-server/index.mjs `MOCK_USER`/`MOCK_PASS`). */
export const CREDENTIALS = { user: 'demo', pass: 'demo' } as const;

/**
 * `/control` is reached DIRECTLY, never through the preview server: the vite
 * proxy only forwards `/api`. Port must match `MOCK_PORT` in
 * playwright.config.ts.
 */
export const MOCK_CONTROL_URL = process.env.MOCK_CONTROL_URL ?? 'http://localhost:5454/control';

/** Scenario names the mock accepts (`SCENARIOS` in mock-server/control.mjs). */
export type ScenarioName = 'login_fail_once' | 'silent_login' | 'reject_all_logins' | 'reset';

/** Every `/control` POST body, exhaustively. */
export type ControlOp =
    | { op: 'push_io'; id: string; state: string }
    | {
          op: 'push_audio';
          id: string;
          /** EVENT vocabulary ('play'|'pause'|'stop'), not get_state's 'playing'. */
          status?: string;
          volume?: number;
          /** A current_track object — whatever keys the medium would carry. */
          track?: Record<string, string>;
      }
    | { op: 'drop' }
    | { op: 'scenario'; name: ScenarioName }
    | { op: 'latency'; ms: number }
    | { op: 'log' }
    | { op: 'reset' };

/**
 * Every frame a cold sign-in produces against the fixture house, in order.
 *
 * `login` and `get_home` are the whole conversation the app had until T17.
 * The three that follow are the audio section's: a player's status, volume,
 * track and position are deliberately NOT in get_home (docs/audio-protocol.md),
 * so the service asks for all of them in one batched `get_state`, and then one
 * `get_cover_url` per player once their tracks are known. The fixture house
 * has two players, hence two `audio` frames.
 *
 * Specs assert this with `expect.poll`: the cover queries are sent from the
 * get_state ANSWER, one round trip after the house lands, so a spec that
 * reads the log the instant it arrives on /#/home would race them.
 */
export const SIGN_IN_FRAMES = ['login', 'get_home', 'get_state', 'audio', 'audio'];

/** One frame the mock received, as recorded by `{op:'log'}`. */
export interface LoggedFrame {
    seq: number;
    at: number;
    /** 1-based, per mock process — a reconnect produces a NEW clientId. */
    clientId: number;
    raw: string;
    /** null when the frame was not valid JSON. */
    frame: { msg: string; data?: Record<string, string> } | null;
}

/** `GET /control` — the status snapshot (also Playwright's readiness probe). */
export interface ControlStatus {
    ok: true;
    service: string;
    port: number;
    user: string;
    /** Open WebSockets. `> 0` is how a spec proves the app actually dialled. */
    clients: number;
    scenario: ScenarioName | null;
    latencyMs: number;
    logSize: number;
    ops: string[];
}

export interface MockControl {
    /** GET /control. */
    status(): Promise<ControlStatus>;
    /** Fixtures, frame log, scenario and latency back to pristine. */
    reset(): Promise<void>;
    /** Destroys every open socket with no close frame; returns how many. */
    drop(): Promise<number>;
    /** Every frame the mock has received since the last reset, in order. */
    log(): Promise<LoggedFrame[]>;
    /** The `msg` of every logged frame — the usual shape of an assertion. */
    frameKinds(): Promise<(string | undefined)[]>;
    /** Just the login frames, for the "who logged in, and when" assertions. */
    loginFrames(): Promise<LoggedFrame[]>;
    /** Forces an IO state server-side and broadcasts `io_changed`. */
    pushIo(id: string, state: string): Promise<{ known: boolean }>;
    /**
     * Forces an audio player's state server-side and broadcasts the matching
     * `audio_*` events — the only way to make something happen to a player
     * that the app did not ask for (someone pressing play on the amp itself).
     */
    pushAudio(
        id: string,
        changes: { status?: string; volume?: number; track?: Record<string, string> },
    ): Promise<{ known: boolean }>;
    /** Arms a login scenario; `'reset'` is the off switch. */
    scenario(name: ScenarioName): Promise<void>;
    /** Delays every outgoing WS frame (and camera snapshot) by `ms`. */
    latency(ms: number): Promise<void>;
    /** Escape hatch: any op, raw response body. */
    send<T = Record<string, unknown>>(op: ControlOp): Promise<T>;
}

/**
 * Binds a `MockControl` to an APIRequestContext.
 *
 * The context MUST be Playwright's node-side `request` fixture rather than
 * `page.request`: the reconnect spec talks to the mock while the browser
 * context is offline, and `page.request` shares the browser's network stack.
 */
export function createMockControl(
    request: APIRequestContext,
    url: string = MOCK_CONTROL_URL,
): MockControl {
    async function send<T>(op: ControlOp): Promise<T> {
        const response = await request.post(url, { data: op });
        const body = (await response.json()) as { ok?: boolean };
        if (!response.ok() || body.ok !== true) {
            throw new Error(
                `mock /control '${op.op}' failed (HTTP ${response.status()}): ${JSON.stringify(body)}`,
            );
        }
        return body as T;
    }

    const log = async (): Promise<LoggedFrame[]> =>
        (await send<{ log: LoggedFrame[] }>({ op: 'log' })).log;

    return {
        send,
        log,

        async status() {
            const response = await request.get(url);
            if (!response.ok()) {
                throw new Error(`mock GET /control failed (HTTP ${response.status()})`);
            }
            return (await response.json()) as ControlStatus;
        },

        async reset() {
            await send({ op: 'reset' });
        },

        async drop() {
            return (await send<{ dropped: number }>({ op: 'drop' })).dropped;
        },

        async frameKinds() {
            return (await log()).map((entry) => entry.frame?.msg);
        },

        async loginFrames() {
            return (await log()).filter((entry) => entry.frame?.msg === 'login');
        },

        async pushIo(id, state) {
            return await send<{ known: boolean }>({ op: 'push_io', id, state });
        },

        async pushAudio(id, changes) {
            return await send<{ known: boolean }>({ op: 'push_audio', id, ...changes });
        },

        async scenario(name) {
            await send({ op: 'scenario', name });
        },

        async latency(ms) {
            await send({ op: 'latency', ms });
        },
    };
}

export const test = base.extend<{ mock: MockControl }>({
    mock: async ({ request }, use) => {
        await use(createMockControl(request));
    },
});

export { expect };

// --------------------------------------------------------------- locators ---

/** The login screen. Ids come straight from LoginView.vue's label bindings. */
export function loginForm(page: Page): {
    username: Locator;
    password: Locator;
    submit: Locator;
    /** The refusal message; also the target of `aria-describedby`. */
    error: Locator;
    /** "No connection to Calaos" — present only while the socket is not open. */
    offline: Locator;
} {
    return {
        username: page.locator('#login-username'),
        password: page.locator('#login-password'),
        submit: page.locator('.login__submit'),
        error: page.locator('#login-error'),
        offline: page.locator('#login-offline'),
    };
}

/**
 * The amber "Connection lost" strip.
 *
 * The text filter is load-bearing: LoginView's message area is ALSO
 * `role="status"`, so a bare `getByRole('status')` matches two nodes on
 * /#/login and resolves to neither.
 */
export function connectionBanner(page: Page): Locator {
    return page.getByRole('status').filter({ hasText: MESSAGES.chrome.connection.lost });
}

/** The chrome that App.vue mounts only while `auth.isAuthed` — i.e. proof of session. */
export function appChrome(page: Page): { navBar: Locator; footerNav: Locator } {
    return {
        navBar: page.getByRole('banner'),
        footerNav: page.getByRole('navigation', { name: MESSAGES.chrome.sections }),
    };
}

// ----------------------------------------------------------------- actions ---

/** Matches the home route and nothing below it (`/#/home/3` is a room). */
export const HOME_URL = /#\/home$/;
export const LOGIN_URL = /#\/login$/;

/**
 * Fills the form, submits, and waits for the house.
 *
 * @returns milliseconds from the click to the arrival on /#/home. LoginView
 * holds its progress beat for `MIN_SPINNER_MS` (400) before letting the route
 * change, so this is never smaller than that.
 */
export async function loginAs(
    page: Page,
    credentials: { user: string; pass: string } = CREDENTIALS,
): Promise<number> {
    const form = loginForm(page);
    await form.username.fill(credentials.user);
    await form.password.fill(credentials.pass);
    // The button is disabled until BOTH fields have content AND the socket is
    // open, so this doubles as the wait for the connection — without it a
    // fast test races the app's first WebSocket handshake.
    await expect(form.submit).toBeEnabled();

    const startedAt = Date.now();
    await form.submit.click();
    await page.waitForURL(HOME_URL);
    return Date.now() - startedAt;
}

/**
 * Records every route change the page makes, from the very first frame.
 *
 * Must be called BEFORE `page.goto()` (it installs an init script). Returns a
 * reader for the list of `location.hash` values in order.
 *
 * vue-router's hash history navigates with `history.pushState`, which fires
 * neither `hashchange` nor `popstate` — hence the wrappers. This exists so a
 * spec can assert on routes the app passed THROUGH, not just where it ended
 * up: "the session survived the reconnect" means it never touched /#/login,
 * and a bounce there and back would be invisible to a final-URL check.
 */
export async function recordNavigation(page: Page): Promise<() => Promise<string[]>> {
    await page.addInitScript(() => {
        const seen: string[] = [location.hash];
        (window as unknown as { __calaosNavLog: string[] }).__calaosNavLog = seen;

        const record = (): void => {
            seen.push(location.hash);
        };
        const push = history.pushState.bind(history);
        const replace = history.replaceState.bind(history);
        history.pushState = (data: unknown, unused: string, url?: string | URL | null): void => {
            push(data, unused, url);
            record();
        };
        history.replaceState = (data: unknown, unused: string, url?: string | URL | null): void => {
            replace(data, unused, url);
            record();
        };
        window.addEventListener('hashchange', record);
        window.addEventListener('popstate', record);
    });

    return () =>
        page.evaluate(
            () => (window as unknown as { __calaosNavLog?: string[] }).__calaosNavLog ?? [],
        );
}
