// Audio, against the built bundle and the mock.
//
// What only E2E can show here is that the app and calaos_server agree about
// audio at all. Every unit spec feeds the store hand-written frames, so they
// prove the app's half of each conversation and nothing about the other half.
// This file makes the round trip: a press produces a real frame in the mock's
// log, the mock answers with the real three-frame sequence (the raw command
// echo, the typed audio_* event, the `on<state>` mirror), and the screen
// follows — including the frames the app never asked for, which is what
// someone pressing play on the amp itself looks like.
//
// Two things about the mock's audio fixtures the assertions lean on
// (mock-server/fixtures/audio.json):
//
//  - `audio_1` (Salon) is a local library track: full LMS tags, a duration,
//    and artwork served from the mock at an LMS-style URL, so the cover chain
//    resolves at stage 1.
//  - `audio_2` (Cuisine) is a stopped radio stream: reduced metadata, no
//    duration, no artwork at all, so the same chain runs to its end and lands
//    on the placeholder. That contrast is the point of testing both.

import { MESSAGES, appChrome, expect, loginAs, test } from './fixtures';
import type { LoggedFrame } from './fixtures';
import type { Locator, Page } from '@playwright/test';

/** mock-server/fixtures/home.json, in wire order — players are never sorted. */
const PLAYERS = ['Salon', 'Cuisine'];

const AUDIO_URL = /#\/audio$/;
const SALON_URL = /#\/audio\/audio_1$/;

const tiles = (page: Page): Locator => page.locator('.player-tile');

const sectionTab = (page: Page, name: string): Locator =>
    appChrome(page).footerNav.getByRole('link', { name });

/** A transport control, found the way a screen reader finds it. */
const control = (page: Page, key: 'play' | 'pause' | 'stop' | 'next' | 'previous'): Locator =>
    page.getByRole('button', { name: MESSAGES.audio[key].replace('{name}', 'Salon') });

/** Every set_state value the mock received for a player, in order. */
function commandsFor(log: LoggedFrame[], id: string): string[] {
    return log
        .filter((entry) => entry.frame?.msg === 'set_state' && entry.frame.data?.id === id)
        .map((entry) => String(entry.frame?.data?.value));
}

async function openAudio(page: Page): Promise<void> {
    await sectionTab(page, MESSAGES.chrome.tabs.audio).click();
    await expect(page).toHaveURL(AUDIO_URL);
}

test.beforeEach(async ({ mock }) => {
    await mock.reset();
});

test('every player in the house arrives with what it is playing', async ({ page, mock }) => {
    await page.goto('/');
    await loginAs(page);
    await openAudio(page);

    await expect(tiles(page)).toHaveCount(PLAYERS.length);
    await expect(page.locator('.player-tile__name')).toHaveText(PLAYERS);
    // Hash history: the href is real and reloadable, and it is keyed by the
    // player's protocol id rather than by its position in the list.
    await expect(tiles(page).first()).toHaveAttribute('href', '#/audio/audio_1');

    // None of this is in get_home — it took the get_state the service issues
    // as soon as the house lands, which is exactly what the old app never did.
    await expect(tiles(page).first().locator('.player-tile__title')).toHaveText(
        'Ambient Kitchen',
    );
    await expect(tiles(page).first().locator('.player-tile__artist')).toHaveText(
        'Calaos Orchestra',
    );
    await expect(tiles(page).first().locator('.player-tile__status')).toHaveText(
        MESSAGES.audio.status.playing,
    );

    const log = await mock.log();
    expect(log.some((entry) => entry.frame?.msg === 'get_state')).toBe(true);
});

test('cover art resolves from the media server, and degrades when there is none', async ({
    page,
}) => {
    await page.goto('/');
    await loginAs(page);
    await openAudio(page);
    await expect(tiles(page)).toHaveCount(PLAYERS.length);

    // Salon: get_cover_url answered an LMS-style URL the mock serves itself,
    // so stage 1 of the chain wins and real bytes decoded.
    const art = tiles(page).first().locator('.cover__art');
    await expect(art).toHaveAttribute('src', /\/music\/17\/cover\.jpg$/);
    expect(await art.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

    // Cuisine: no artwork anywhere — empty cover URL, and the base64 path
    // answers `unable get url`. The chain runs to its end and shows the glyph
    // rather than a broken image.
    await expect(tiles(page).nth(1).locator('.cover__placeholder')).toBeVisible();
    await expect(tiles(page).nth(1).locator('.cover__art')).toHaveCount(0);
});

test('the player screen drives the real player', async ({ page, mock }) => {
    await page.goto('/');
    await loginAs(page);
    await openAudio(page);
    await tiles(page).first().click();

    await expect(page).toHaveURL(SALON_URL);
    await expect(page.locator('.player__name')).toHaveText('Salon');
    await expect(page.locator('.player__track')).toHaveText('Ambient Kitchen');
    await expect(page.locator('.player__album')).toHaveText('Home Automation Vol. 1');
    await expect(page.locator('.player__eyebrow')).toHaveText(MESSAGES.audio.status.playing);

    // Position is display-only — the protocol has no seek — so the screen
    // offers no way to move it.
    await expect(page.locator('.player__filament')).toHaveAttribute('role', 'progressbar');
    await expect(page.locator('.player__position input')).toHaveCount(0);

    // --- pause: our frame goes out, the mock's event comes back -------------
    await control(page, 'pause').click();
    await expect(page.locator('.player__eyebrow')).toHaveText(MESSAGES.audio.status.pause);
    expect(commandsFor(await mock.log(), 'audio_1')).toEqual(['pause']);

    // --- play again: the toggle now offers the other verb -------------------
    await control(page, 'play').click();
    await expect(page.locator('.player__eyebrow')).toHaveText(MESSAGES.audio.status.playing);
    expect(commandsFor(await mock.log(), 'audio_1')).toEqual(['pause', 'play']);

    // --- next: the playlist really moves ------------------------------------
    await control(page, 'next').click();
    await expect(page.locator('.player__track')).toHaveText('Shutter Waltz');
    expect(commandsFor(await mock.log(), 'audio_1')).toContain('next');

    // --- previous: spelled the way set_value reads it, never 'prev' ---------
    await control(page, 'previous').click();
    await expect(page.locator('.player__track')).toHaveText('Ambient Kitchen');
    expect(commandsFor(await mock.log(), 'audio_1')).toContain('previous');

    // --- stop ----------------------------------------------------------------
    await control(page, 'stop').click();
    await expect(page.locator('.player__eyebrow')).toHaveText(MESSAGES.audio.status.stop);
    expect(commandsFor(await mock.log(), 'audio_1')).toContain('stop');
});

test('the volume slider commits once, on release, as an absolute command', async ({
    page,
    mock,
}) => {
    await page.goto('/');
    await loginAs(page);
    await page.goto('/#/audio/audio_1');

    const slider = page.locator('.player__volume input[type="range"]');
    await expect(slider).toHaveValue('35');
    await expect(page.locator('.player__volume-value')).toHaveText('35%');

    // `fill` sets the value and fires input+change — the keyboard path, which
    // BaseSlider commits exactly once.
    await slider.fill('70');

    // The level on screen is the SERVER's: it only moves once the mock's
    // audio_volume_changed comes back.
    await expect(page.locator('.player__volume-value')).toHaveText('70%');
    expect(commandsFor(await mock.log(), 'audio_1')).toEqual(['volume set 70']);
});

test('the screen follows a player somebody else is driving', async ({ page, mock }) => {
    await page.goto('/');
    await loginAs(page);
    await page.goto('/#/audio/audio_2');

    // The stopped radio stream: reduced metadata, no duration, so the filament
    // is not drawn at all and only the elapsed clock is shown.
    await expect(page.locator('.player__name')).toHaveText('Cuisine');
    await expect(page.locator('.player__eyebrow')).toHaveText(MESSAGES.audio.status.stop);
    await expect(page.locator('[role="progressbar"]')).toHaveCount(0);
    await expect(page.locator('.player__clock')).toHaveCount(1);

    // Nothing below is a reply to anything the app sent — this is the amp's
    // own front panel being used while the screen is open.
    await mock.pushAudio('audio_2', { status: 'play' });
    await expect(page.locator('.player__eyebrow')).toHaveText(MESSAGES.audio.status.playing);
    await expect(page.locator('.player__dot')).toBeVisible();

    await mock.pushAudio('audio_2', { volume: 20 });
    await expect(page.locator('.player__volume-value')).toHaveText('20%');

    await mock.pushAudio('audio_2', {
        track: { title: 'Nocturne', artist: 'FIP', album: 'Radio France', duration: '240' },
    });
    await expect(page.locator('.player__track')).toHaveText('Nocturne');
    await expect(page.locator('.player__artist')).toHaveText('FIP');
    // A duration arrived with the new track, so the position line appears.
    await expect(page.locator('[role="progressbar"]')).toHaveCount(1);
});

test('the list screen follows the same events without being opened', async ({ page, mock }) => {
    await page.goto('/');
    await loginAs(page);
    await openAudio(page);
    await expect(tiles(page).nth(1).locator('.player-tile__status')).toHaveText(
        MESSAGES.audio.status.stop,
    );

    await mock.pushAudio('audio_2', { status: 'play' });

    await expect(tiles(page).nth(1).locator('.player-tile__status')).toHaveText(
        MESSAGES.audio.status.playing,
    );
    await expect(tiles(page).nth(1).locator('.player-tile__dot')).toBeVisible();
});

test('the elapsed clock keeps running between anchors', async ({ page }) => {
    await page.goto('/');
    await loginAs(page);
    await page.goto('/#/audio/audio_1');

    const clock = page.locator('.player__clock').first();
    const before = await clock.textContent();

    // There is no position event and no seek: the clock is arithmetic between
    // get_state anchors, and this is the only place that can be observed.
    await expect(clock).not.toHaveText(String(before), { timeout: 5000 });
});

test('a deep link to a player that is gone degrades to an empty screen', async ({ page }) => {
    await page.goto('/');
    await loginAs(page);

    // A bookmark from a house that has since lost the player. The route param
    // is opaque and unbounded on purpose, so the guard lets this through and
    // the view is what has to cope.
    await page.goto('/#/audio/audio_gone');

    await expect(page.locator('.player')).toHaveCount(0);
    // The shell is intact — the section tabs still work, so this is a dead
    // end rather than a dead app.
    await expect(appChrome(page).footerNav).toBeVisible();
    await sectionTab(page, MESSAGES.chrome.tabs.audio).click();
    await expect(tiles(page)).toHaveCount(PLAYERS.length);
});
