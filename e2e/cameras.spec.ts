// The cameras, against the built bundle and the mock.
//
// What only an E2E can show here is that the polling chain is REAL: a unit
// spec drives `load` and `error` by hand on fake timers, so it can prove the
// state machine but never that a browser actually fetches a picture, decodes
// it, and comes back 250 ms later for the next one. That — and what happens
// when the camera stops answering — is what this file is for.
//
// Counting requests: the mock's `/control` log records WebSocket frames only.
// Snapshots are plain HTTP GETs on `/api`, they never reach that log, and
// `GET /control` exposes no counter for them either (mock-server/control.mjs
// `controlStatus`). So the count is taken from the browser's own network
// stack, which is in any case closer to the claim being made: the APP keeps
// asking, and stops when it should.

import {
    HOME_URL,
    LOGIN_URL,
    MESSAGES,
    appChrome,
    expect,
    loginAs,
    recordNavigation,
    test,
} from './fixtures';
import type { Locator, Page } from '@playwright/test';

/** mock-server/fixtures/home.json, in wire order — cameras are never sorted. */
const CAMERAS = ['Entrée', 'Jardin'];

const SECURITY_URL = /#\/security$/;
const FIRST_CAMERA_URL = /#\/security\/0$/;

/**
 * A snapshot request. The `action` check is load-bearing: the WebSocket lives
 * on the same `/api` path and must never be caught by this.
 */
const isSnapshotRequest = (url: URL): boolean =>
    url.pathname === '/api' && url.searchParams.get('action') === 'camera';

/** Starts counting snapshot requests; the returned reader is the tally. */
function snapshotCounter(page: Page): () => number {
    let count = 0;
    page.on('request', (request) => {
        if (isSnapshotRequest(new URL(request.url()))) count += 1;
    });
    return () => count;
}

const tiles = (page: Page): Locator => page.locator('.camera-tile');
const pictures = (page: Page): Locator => page.locator('.camera-frame__picture');
/** Shown only once a frame has decoded — the proof a picture is on screen. */
const liveBadges = (page: Page): Locator => page.locator('.camera-frame__live');
const placeholder = (page: Page): Locator => page.locator('.camera-frame__state--down');

const sectionTab = (page: Page, name: string): Locator =>
    appChrome(page).footerNav.getByRole('link', { name });

async function openSecurity(page: Page): Promise<void> {
    await sectionTab(page, MESSAGES.chrome.tabs.security).click();
    await expect(page).toHaveURL(SECURITY_URL);
}

/** The width of the picture's box (its `object-fit` does not change it). */
async function pictureWidth(picture: Locator): Promise<number> {
    return await picture.evaluate((img) => img.getBoundingClientRect().width);
}

test.beforeEach(async ({ mock }) => {
    await mock.reset();
});

test('every camera in the house arrives as a live picture', async ({ page }) => {
    await page.goto('/');
    await loginAs(page);
    await openSecurity(page);

    await expect(tiles(page)).toHaveCount(CAMERAS.length);
    await expect(page.locator('.camera-tile__name')).toHaveText(CAMERAS);
    // Hash history: the href is a real, reloadable deep link.
    await expect(tiles(page).first()).toHaveAttribute('href', '#/security/0');

    // The badge means a frame decoded; the natural size means the bytes were
    // a picture (mock-server/fixtures/camera.png, 96×72) and not a 403 page.
    await expect(liveBadges(page)).toHaveCount(CAMERAS.length);
    await expect(liveBadges(page).first()).toHaveText(MESSAGES.camera.live);

    for (let index = 0; index < CAMERAS.length; index += 1) {
        const natural = await pictures(page)
            .nth(index)
            .evaluate((img) => {
                const picture = img as HTMLImageElement;
                return { width: picture.naturalWidth, height: picture.naturalHeight };
            });
        expect(natural.width).toBeGreaterThan(0);
        expect(natural.height).toBeGreaterThan(0);
    }
});

test('the pictures keep refreshing, one chained request at a time', async ({ page }) => {
    const snapshots = snapshotCounter(page);
    await page.goto('/');
    await loginAs(page);
    await openSecurity(page);
    await expect(liveBadges(page)).toHaveCount(CAMERAS.length);

    const before = snapshots();
    await page.waitForTimeout(1200);
    const after = snapshots();

    // 250 ms between frames, per camera: ~8 requests in this window for the
    // two cameras. The floor is deliberately low — what is being asserted is
    // that the chain is alive, not the exact cadence of a loaded box.
    expect(after - before).toBeGreaterThanOrEqual(3);
    // And that it is CHAINED: the old directive re-armed every 10 ms, which
    // over 1.2 s would be hundreds of requests.
    expect(after - before).toBeLessThan(60);
});

test('leaving the section stops the polling', async ({ page }) => {
    const navigationLog = await recordNavigation(page);
    const snapshots = snapshotCounter(page);
    await page.goto('/');
    await loginAs(page);
    await openSecurity(page);
    await expect(liveBadges(page)).toHaveCount(CAMERAS.length);

    await sectionTab(page, MESSAGES.chrome.tabs.home).click();
    await expect(page).toHaveURL(HOME_URL);
    await expect(page.locator('.room-tile').first()).toBeVisible();

    // The requests that were already in flight when the views unmounted still
    // land; nothing after them may.
    await page.waitForTimeout(500);
    const settled = snapshots();
    await page.waitForTimeout(1500);

    expect(snapshots()).toBe(settled);

    // And the session is untouched by any of it: the only visit to the login
    // form is the cold load, before anyone signed in.
    const visited = await navigationLog();
    const sinceHome = visited.slice(visited.findIndex((hash) => HOME_URL.test(hash)));
    expect(sinceHome.filter((hash) => LOGIN_URL.test(hash))).toEqual([]);
});

test('a camera that stops answering falls back to a placeholder, and retry brings it back', async ({
    page,
}) => {
    await page.goto('/');
    await loginAs(page);
    await openSecurity(page);
    await tiles(page).first().click();

    await expect(page).toHaveURL(FIRST_CAMERA_URL);
    await expect(page.locator('.camera__name')).toHaveText(CAMERAS[0]);
    await expect(liveBadges(page)).toHaveCount(1);

    // Killed from the browser side rather than through the mock: one mock
    // serves the whole run, and breaking its camera endpoint would break it
    // for every other spec too.
    await page.route(isSnapshotRequest, (route) => route.abort());

    // Three consecutive failures, at 0 s, +1 s and +2 s of backoff.
    await expect(placeholder(page)).toBeVisible();
    await expect(placeholder(page)).toContainText(MESSAGES.camera.unavailable);
    // The stale picture goes with it: an old frame from a security camera is
    // worse than an honest empty frame.
    await expect(liveBadges(page)).toHaveCount(0);

    await page.unroute(isSnapshotRequest);
    await page.getByRole('button', { name: MESSAGES.camera.retry }).click();

    // Comfortably inside the 4 s the backoff was going to wait: it is the
    // button that brought the picture back, not the next scheduled attempt.
    await expect(placeholder(page)).toBeHidden({ timeout: 3000 });
    await expect(liveBadges(page)).toHaveCount(1);
});

test('the single view gives the picture more room than its tile', async ({ page, isMobile }) => {
    test.skip(isMobile === true, 'a tile on a phone is already the full width of the screen');

    await page.goto('/');
    await loginAs(page);
    await openSecurity(page);
    await expect(liveBadges(page)).toHaveCount(CAMERAS.length);
    const onTheTile = await pictureWidth(pictures(page).first());

    await tiles(page).first().click();
    await expect(page).toHaveURL(FIRST_CAMERA_URL);
    await expect(liveBadges(page)).toHaveCount(1);

    // The old single view was a fixed 640×480 slab inside a 680×518 bitmap
    // bezel; this one is fluid up to a cap, so it is bigger than a tile on
    // every screen wide enough to have shown more than one tile.
    expect(await pictureWidth(pictures(page).first())).toBeGreaterThan(onTheTile);
    await expect(pictures(page).first()).toHaveCSS('object-fit', 'contain');
});
