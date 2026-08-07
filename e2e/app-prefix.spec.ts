// The production URL layout, which no other spec exercises.
//
// calaos_server serves this app under `/app/`, never at the origin root
// (calaos_base src/bin/calaos_server/HttpClient.cpp — the router is
// reproduced in e2e/calaos-server-sim.mjs). Everything else in this repo —
// `vite dev`, `vite preview`, the mock — serves it at `/`, so a bundle built
// with vite's default `base: '/'` passes the entire suite and is dead on a
// real box: index.html asks for `/assets/index-*.js`, that URL escapes the
// prefix, the router answers its text/html 404 page, and the browser refuses
// to execute it ("MIME type of text/html is not a valid JavaScript MIME
// type"). That shipped once; `base: './'` in vite.config.ts is the fix and
// this spec is the tripwire.
//
// Scoped to `chromium-desktop` (playwright.config.ts `testIgnore`): this is a
// URL/routing regression, not a layout or locale one, so one browser project
// is the whole job.

import { CREDENTIALS, HOME_URL, expect, loginAs, loginForm, test } from './fixtures';

/**
 * e2e/calaos-server-sim.mjs, the third `webServer` entry. Absolute on purpose:
 * `use.baseURL` is the `vite preview` origin (the root layout) and every other
 * spec depends on it, so this spec never navigates relatively.
 */
const SIM_ORIGIN = process.env.SIM_ORIGIN ?? 'http://localhost:4180';

/** Where `/` must land — upstream's 301 target. */
const ENTRY_URL = `${SIM_ORIGIN}/app/index.html`;

/**
 * A message that means "an asset URL escaped the prefix". Chromium's module
 * refusal names the MIME type; a plain fetch failure names the module.
 */
const ASSET_FAILURE = /mime|module script|failed to load module|net::err/i;

/** Collects the console errors and uncaught exceptions of a page, from frame 0. */
function collectPageErrors(page: import('@playwright/test').Page): string[] {
    const errors: string[] = [];
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    return errors;
}

test.beforeEach(async ({ mock }) => {
    await mock.reset();
});

test('the app boots, signs in and talks to /api under the /app/ prefix', async ({ page, mock }) => {
    const errors = collectPageErrors(page);

    // The bare root, exactly what a user types. Upstream 301s it.
    await page.goto(`${SIM_ORIGIN}/`);

    // Redirect followed, and the router landed the app on its login route:
    // the hash rides on top of the prefixed document path.
    await expect(page).toHaveURL(`${ENTRY_URL}#/login`);

    // The form only exists if the module script parsed and Vue mounted — i.e.
    // if every asset URL in index.html resolved under the prefix.
    const form = loginForm(page);
    await expect(form.username).toBeVisible();
    await expect(form.submit).toBeVisible();

    // The app dialled ws://…:4180/api and the prefix server forwarded it.
    await expect
        .poll(async () => (await mock.status()).clients, {
            message: 'the app never opened a WebSocket through the /app/ prefix',
        })
        .toBeGreaterThan(0);

    // `loginAs` is base-URL free (it fills locators and waits on the HOME_URL
    // regex, which matches the full URL), so it is reused as-is here.
    await loginAs(page, CREDENTIALS);

    await expect(page).toHaveURL(`${ENTRY_URL}#/home`);
    await expect(page).toHaveURL(HOME_URL);
    // Tiles are rendered from the get_home answer: JS ran AND the WebSocket
    // round trip completed, both through the prefix.
    await expect(page.locator('.room-tile').first()).toBeVisible();

    expect(errors.filter((message) => ASSET_FAILURE.test(message))).toEqual([]);
});

test('index.html references its assets relatively, and they only exist under /app/', async ({
    request,
}) => {
    const html = await (await request.get(ENTRY_URL)).text();

    // The built entry script, read out of the served document rather than off
    // disk — the hash changes every build, and this asserts on what the
    // browser is actually told to fetch.
    const scriptSrc = /<script[^>]*\ssrc="([^"]+)"/.exec(html)?.[1];
    expect(scriptSrc, 'no module script in the built index.html').toBeTruthy();

    // THE regression. `/assets/…` here means vite's base went back to '/'.
    expect(scriptSrc).toMatch(/^\.\/assets\//);

    const assetPath = (scriptSrc as string).replace(/^\.\//, '');

    // Resolved the way the browser resolves it, against /app/index.html.
    const underPrefix = await request.get(`${SIM_ORIGIN}/app/${assetPath}`);
    expect(underPrefix.status()).toBe(200);
    expect(underPrefix.headers()['content-type']).toContain('javascript');

    // And the production contract this all rests on: outside /app/ there is
    // no static file server at all, only the 404 page whose text/html
    // Content-Type is what breaks a module script.
    const atRoot = await request.get(`${SIM_ORIGIN}/${assetPath}`);
    expect(atRoot.status()).toBe(404);
    expect(atRoot.headers()['content-type']).toContain('text/html');
});
