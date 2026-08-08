// The house and one of its rooms, against the built bundle and the mock.
//
// What only an E2E can show here is the LAYOUT: the room grid is a CSS grid
// with `auto-fill`, which replaced a controller that chunked the rooms into
// rows of three in JavaScript — three columns on a phone, three columns on a
// wall panel. Column counts and tile geometry exist only in a real engine, so
// they are measured here rather than asserted on a class name.

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

/**
 * mock-server/fixtures/home.json, in the order the store sorts it: `hits` desc
 * (47, 25, 12, 3), which is nothing like the order the frame arrives in.
 */
const ROOMS = [
    { name: 'Cuisine', type: MESSAGES.roomType.kitchen, temp: null },
    { name: 'Extérieur', type: MESSAGES.roomType.outside, temp: '8.2 °C' },
    { name: 'Salon', type: MESSAGES.roomType.lounge, temp: '21.5 °C' },
    { name: 'Chambre', type: MESSAGES.roomType.bedroom, temp: null },
];

/** A phone the app has to work on; also the mobile project's own viewport. */
const PHONE = { width: 412, height: 915 };

function tiles(page: Page): Locator {
    return page.locator('.room-tile');
}

function backButton(page: Page): Locator {
    return appChrome(page).navBar.getByRole('button', { name: MESSAGES.chrome.back });
}

test.beforeEach(async ({ mock }) => {
    await mock.reset();
});

test('the house arrives most-used first, each room carrying its picture and temperature', async ({
    page,
}) => {
    await page.goto('/');
    await loginAs(page);

    await expect(tiles(page)).toHaveCount(ROOMS.length);
    await expect(page.locator('.room-tile__name')).toHaveText(ROOMS.map((room) => room.name));
    // Each tile carries its own room picture, and no two are the same. The
    // type is deliberately NOT written out — the picture says it (HomeView).
    await expect(page.locator('.room-tile__icon')).toHaveCount(ROOMS.length);
    await expect(page.locator('.room-tile__type')).toHaveCount(0);
    const pictures = await page.locator('.room-tile__icon').evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLImageElement).currentSrc),
    );
    expect(new Set(pictures).size).toBe(ROOMS.length);

    // Only the two rooms with a temp IO show a reading, and it carries the
    // server's unit (the old tile hardcoded °C).
    await expect(page.locator('.room-tile__temp')).toHaveText(
        ROOMS.filter((room) => room.temp !== null).map((room) => room.temp as string),
    );
    for (const [index, room] of ROOMS.entries()) {
        await expect(tiles(page).nth(index).locator('.room-tile__temp')).toHaveCount(
            room.temp === null ? 0 : 1,
        );
    }
});

test('the grid fits two columns on a phone, with nothing off the side', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/');
    await loginAs(page);
    await expect(tiles(page)).toHaveCount(ROOMS.length);

    const layout = await page.evaluate(() => {
        const scroller = document.querySelector('.app-shell__content') as HTMLElement;
        const boxes = [...document.querySelectorAll('.room-tile')].map((tile) =>
            tile.getBoundingClientRect(),
        );
        return {
            // Distinct left edges = columns. Rounded: sub-pixel track sizes
            // would otherwise count as separate columns.
            columns: new Set(boxes.map((box) => Math.round(box.x))).size,
            widest: Math.max(...boxes.map((box) => box.right)),
            viewport: window.innerWidth,
            // The shell's content area is the app's only scroll container.
            scrollWidth: scroller.scrollWidth,
            clientWidth: scroller.clientWidth,
        };
    });

    // The old app's JS chunking gave a 412 px phone three columns of 137 px.
    expect(layout.columns).toBeGreaterThanOrEqual(2);
    expect(layout.widest).toBeLessThanOrEqual(layout.viewport);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
});

test('a tile opens its room, and back returns to the house', async ({ page }) => {
    await page.goto('/');
    await loginAs(page);

    // No back button on the list itself — it appears on detail routes only.
    await expect(backButton(page)).toHaveCount(0);

    await tiles(page).nth(1).click();
    await expect(page).toHaveURL(/#\/home\/1$/);

    await expect(page.locator('.room__name')).toHaveText('Extérieur');
    await expect(page.locator('.room__type')).toHaveText(MESSAGES.roomType.outside);
    // What each row DOES is its own component's business; that these are the
    // RIGHT IOs, in the order the server sent them, is this view's job.
    await expect(page.locator('.io-row__name')).toHaveText([
        'Température extérieure',
        'Éclairage terrasse',
        'Store terrasse',
        'Durée arrosage',
        'Tout éteindre',
        // Two `light`s with an `io_style`: a pump and a boiler, which the row
        // draws as those devices rather than as lamps.
        'Pompe piscine',
        'Chaudière',
    ]);

    await expect(backButton(page)).toBeVisible();
    await backButton(page).click();
    await expect(page).toHaveURL(HOME_URL);
    await expect(tiles(page)).toHaveCount(ROOMS.length);
});

test('an IO the server marked invisible is nowhere in the room', async ({ page }) => {
    await page.goto('/');
    await loginAs(page);

    await tiles(page).nth(3).click();
    await expect(page).toHaveURL(/#\/home\/3$/);

    await expect(page.locator('.room__name')).toHaveText('Chambre');
    await expect(page.locator('.io-row__name')).toHaveCount(4);
    await expect(page.getByText('LED de debug')).toHaveCount(0);
});

test('a stale deep link falls back to the house instead of an empty room', async ({ page }) => {
    const navigationLog = await recordNavigation(page);
    await page.goto('/');
    await loginAs(page);

    // The room list shrinks between sessions (a room is deleted, another
    // account signs in), so a bookmarked /#/home/99 outlives its room.
    await page.evaluate(() => {
        location.hash = '#/home/99';
    });

    await expect(page).toHaveURL(HOME_URL);
    await expect(tiles(page)).toHaveCount(ROOMS.length);

    // And it is the ROOM LIST it falls back to, not the login form: the
    // session is intact, so nothing after the sign-in may touch /#/login —
    // a bounce there and back would be invisible to a final-URL check.
    const visited = await navigationLog();
    const sinceHome = visited.slice(visited.findIndex((hash) => HOME_URL.test(hash)));
    expect(sinceHome).toContain('#/home/99');
    expect(sinceHome.filter((hash) => LOGIN_URL.test(hash))).toEqual([]);
});

test('a temperature pushed by the server lands on the tile', async ({ page, mock }) => {
    await page.goto('/');
    await loginAs(page);
    await expect(tiles(page).nth(2).locator('.room-tile__temp')).toHaveText('21.5 °C');

    await mock.pushIo('input_1', '23.7');

    // No reload, no re-fetch of the house: the io_changed event patches the
    // one IO the tile reads.
    await expect(tiles(page).nth(2).locator('.room-tile__temp')).toHaveText('23.7 °C');
    await expect(page).toHaveURL(HOME_URL);
});
