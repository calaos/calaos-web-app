// The `fr` project's whole reason to exist (T19): prove the app actually
// renders French when the browser says so, and that it does NOT translate
// anything the server sent — only the app's own catalogue is a translation.
//
// Deliberately small. The rest of the E2E suite (behaviour, layout,
// reconnection…) already runs twice, in English, on chromium-desktop and
// mobile-pixel7; re-running all of it a third time under a different locale
// would triple the wall-clock cost of this project for zero new coverage —
// vue-i18n's `t()` does not change how anything BEHAVES, only what it prints.
// This file is the only thing playwright.config.ts lets the `fr` project run
// (`testMatch`), and the only thing chromium-desktop/mobile-pixel7 exclude
// (`testIgnore`) — see the comments there.
//
// `MESSAGES` from ./fixtures is English (its own doc comment says so), so
// assertions here read `fr.json` directly instead.

import { CREDENTIALS, expect, loginAs, test } from './fixtures';
import fr from '../app/src/i18n/fr.json';

test.beforeEach(async ({ mock }) => {
    await mock.reset();
});

test('the login screen renders in French', async ({ page }) => {
    await page.goto('/');

    // The brand name is not a translated string (app.name is "Calaos" in
    // both catalogues, see docs/tasks/T19-i18n.md's grep-audit exceptions):
    // asserting it here pins that on purpose, alongside copy that DOES change.
    await expect(page.locator('.login__eyebrow')).toHaveText(fr.app.name);
    await expect(page.locator('.login__welcome')).toHaveText(fr.login.welcome);
    await expect(page.locator('.login__label')).toHaveText([fr.login.username, fr.login.password]);

    // Not yet submitting, so the button carries login.submit, not .submitting.
    await expect(page.locator('.login__submit')).toHaveText(fr.login.submit);
});

test('the house renders in French: heading, tabs, and a room type label', async ({ page }) => {
    await page.goto('/');
    await loginAs(page, CREDENTIALS);

    // Visually hidden, but present in the DOM for assistive tech — same node
    // login.spec.ts's english counterpart never checks, because this is the
    // one place a locale swap could go unnoticed on screen.
    await expect(page.locator('.home h1')).toHaveText(fr.home.title);

    await expect(page.locator('.footer-nav__label')).toHaveText([
        fr.chrome.tabs.home,
        fr.chrome.tabs.audio,
        fr.chrome.tabs.security,
    ]);

    // mock-server/fixtures/home.json's first room by `hits` (47): kitchen.
    // Reading the catalogue rather than hardcoding "Cuisine" here means a
    // future wording change to roomType.kitchen cannot make this spec stale.
    // The tile itself no longer prints the type — the room's picture says it —
    // so the translated label is checked where it still appears: the header of
    // the room the tile opens.
    await page.locator('.room-tile').first().click();
    await expect(page.locator('.room__type')).toHaveText(fr.roomType.kitchen);
    // And it is a TRANSLATION, not the wire value passed through untouched.
    await expect(page.locator('.room__type')).not.toHaveText('kitchen');
});

test('server-provided room and IO names are never translated', async ({ page }) => {
    await page.goto('/');
    await loginAs(page, CREDENTIALS);

    // Second tile by `hits` (25): "Extérieur" (mock-server/fixtures/home.json)
    // — chosen for its accent, a fair test that the fr locale round-trips
    // UTF-8 correctly, not just plain ASCII copy.
    await page.locator('.room-tile').nth(1).click();

    // The room's own name, verbatim off the wire — never looked up in fr.json.
    await expect(page.locator('.room__name')).toHaveText('Extérieur');
    // Its TYPE, right next to it, is the translated label — same word here by
    // coincidence of this particular fixture room, but sourced from fr.json
    // (roomType.outside), not from the room's name.
    await expect(page.locator('.room__type')).toHaveText(fr.roomType.outside);

    // The room's IOs carry names no catalogue entry could be confused with —
    // proof the server's own words survive a French session unmodified.
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
});
