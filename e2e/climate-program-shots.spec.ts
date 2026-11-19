// Captures of the climate program (card, settings, editor) for the UI review,
// on a fixed clock. Kept only with ARCHI_SHOT=1; the assertions just keep a
// capture from showing the wrong state.

import { MESSAGES, expect, loginAs, test } from './fixtures';
import type { Locator, Page, TestInfo } from '@playwright/test';

const LOUNGE = 2;
const C = MESSAGES.climate;
const P = MESSAGES.program;
const S = MESSAGES.schedule;
// A Monday morning, so a level is in force and the next change is near.
const NOW = '2026-11-16T10:00:00';

const row = (page: Page, name: string): Locator =>
    page.locator('.io-row').filter({ has: page.locator('.io-row__name', { hasText: name }) });
const settings = (page: Page): Locator => page.locator('.climate-detail');
const editor = (page: Page): Locator => page.getByRole('dialog').filter({ has: page.locator('.schedule') });

// The room list scrolls inside the shell, so a full-page capture misses a row
// below the fold: the card is captured as an element.
async function shotRow(page: Page, testInfo: TestInfo, name: string, target: Locator): Promise<void> {
    await target.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await target.screenshot({ path: testInfo.outputPath(`${name}.png`) });
}

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => Promise.all(document.getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined))));
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
}

async function setMode(page: Page, label: string): Promise<void> {
    await settings(page).locator('.climate-detail__pill').click();
    await page.getByRole('dialog', { name: C.modeTitle }).getByRole('radio', { name: label }).click();
}

test.beforeEach(async ({ page, mock }) => {
    await mock.reset();
    await mock.send({ op: 'program_clock', clock: new Date(NOW).toISOString() });
    await page.clock.setFixedTime(new Date(NOW));
    await page.goto('/');
    await loginAs(page);
    await page.locator('.room-tile').nth(LOUNGE).click();
    await expect(row(page, 'Thermostat bureau')).toBeVisible();
});

test('card: program on, paused, absent', async ({ page }, testInfo) => {
    const card = row(page, 'Thermostat bureau');
    await shotRow(page, testInfo, 'card-1-enabled', card);
    await card.getByRole('switch').click();
    await expect(card.getByRole('switch')).not.toBeChecked();
    await shotRow(page, testInfo, 'card-2-paused', card);
    await expect(row(page, 'Climatisation salon').getByRole('switch')).toHaveCount(0);
    await shotRow(page, testInfo, 'card-3-absent', row(page, 'Climatisation salon'));
});

test('card: keyboard focus on the row', async ({ page }, testInfo) => {
    const card = row(page, 'Thermostat bureau');
    await card.locator('.io-row__main').focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(card.locator('.io-row__main')).toBeFocused();
    await expect(card.locator('.io-row__main')).toHaveCSS('outline-style', 'solid');
    await shotRow(page, testInfo, 'card-4-focus', card);
});

test('editor: Resume refused by the server', async ({ page, mock }, testInfo) => {
    await row(page, 'Thermostat bureau').click();
    await settings(page).getByRole('switch').click();
    await expect(settings(page).locator('.climate-detail__paused')).toBeVisible();
    await settings(page).getByRole('button', { name: S.edit }).click();
    const dialog = editor(page);
    await expect(dialog.getByRole('group', { name: /Monday, Heating/ })).toBeVisible({ timeout: 15_000 });
    await mock.send({ op: 'program_reject' });
    await dialog.getByRole('button', { name: P.resume }).click();
    await expect(dialog.getByRole('alert').filter({ hasText: P.error.generic })).toBeVisible();
    await shot(page, testInfo, 'editor-6-resume-refused');
});

test('detail: heating and cooling tabs, auto with help', async ({ page }, testInfo) => {
    await row(page, 'Thermostat bureau').click();
    await setMode(page, C.mode.heat);
    await expect(settings(page).locator('.climate-detail__program')).toBeVisible();
    await shot(page, testInfo, 'detail-1-heat');
    await setMode(page, C.mode.cool);
    await shot(page, testInfo, 'detail-2-cool');
    await setMode(page, C.mode.auto);
    await shot(page, testInfo, 'detail-3-auto');
    await settings(page).locator('.climate-detail__program').scrollIntoViewIfNeeded();
    await shot(page, testInfo, 'detail-3b-auto-program');
    await settings(page).getByRole('button', { name: P.help }).click();
    await expect(settings(page).locator('.climate-detail__helptext')).toBeVisible();
    await shot(page, testInfo, 'detail-4-auto-help');
    await settings(page).getByRole('switch').click();
    await expect(settings(page).locator('.climate-detail__paused')).toBeVisible();
    await shot(page, testInfo, 'detail-5-auto-paused');
});

test('editor: loading, heating, cooling, paused, read-only', async ({ page, mock }, testInfo) => {
    await mock.send({ op: 'latency', ms: 3000 });
    await row(page, 'Thermostat bureau').click();
    await settings(page).getByRole('button', { name: S.edit }).click();
    const dialog = editor(page);
    await expect(dialog.locator('.schedule__loading')).toBeVisible();
    await shot(page, testInfo, 'editor-1-loading');
    await mock.send({ op: 'latency', ms: 0 });
    await expect(dialog.getByRole('group', { name: /Monday, Heating/ })).toBeVisible({ timeout: 15_000 });
    await shot(page, testInfo, 'editor-2-heat');
    await dialog.getByRole('tab', { name: /^Cooling/ }).click();
    await shot(page, testInfo, 'editor-3-cool');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await settings(page).getByRole('switch').click();
    await setMode(page, C.mode.auto);
    await settings(page).getByRole('button', { name: S.edit }).click();
    await expect(editor(page).getByRole('group', { name: /Monday, Heating/ })).toBeVisible();
    await shot(page, testInfo, 'editor-4-auto-paused');
    await mock.drop();
    await expect(editor(page).getByText(S.readOnly)).toBeVisible();
    await shot(page, testInfo, 'editor-5-readonly');
});
