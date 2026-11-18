// The program on the climate card and in its settings, against the mock's
// time programs. The mock reads the server clock, so what is active "now" is
// asserted by shape; the exact hours are covered by the Vitest specs.

import { MESSAGES, expect, loginAs, test } from './fixtures';
import type { MockControl } from './fixtures';
import type { Locator, Page } from '@playwright/test';

const LOUNGE = 2;
const PROGRAM_IO = 'thermo_bureau_program_enabled';
const WITH = 'Thermostat bureau';
const WITHOUT = 'Climatisation salon';
const C = MESSAGES.climate;
const P = MESSAGES.program;

function row(page: Page, name: string): Locator {
    return page.locator('.io-row').filter({ has: page.locator('.io-row__name', { hasText: name }) });
}

const settings = (page: Page): Locator => page.locator('.climate-detail');
const section = (page: Page): Locator => settings(page).locator('.climate-detail__program');

async function openLounge(page: Page): Promise<void> {
    await page.goto('/');
    await loginAs(page);
    await page.locator('.room-tile').nth(LOUNGE).click();
    await expect(page).toHaveURL(new RegExp(`#/home/${LOUNGE}$`));
}

async function setMode(page: Page, label: string): Promise<void> {
    await settings(page).locator('.climate-detail__pill').click();
    await page.getByRole('dialog', { name: C.modeTitle }).getByRole('radio', { name: label }).click();
}

async function programWrites(mock: MockControl): Promise<string[]> {
    return (await mock.log())
        .filter((e) => e.frame?.msg === 'set_state' && e.frame.data?.id === PROGRAM_IO)
        .map((e) => e.frame?.data?.value ?? '');
}

test.beforeEach(async ({ mock }) => {
    await mock.reset();
});

test('the switch on the row sends program_enabled and does not open the settings', async ({ page, mock }) => {
    await openLounge(page);
    const toggle = row(page, WITH).getByRole('switch');
    await expect(toggle).toBeChecked();

    await toggle.click();
    await expect.poll(() => programWrites(mock)).toEqual(['false']);
    await expect(toggle).not.toBeChecked();
    await expect(settings(page)).toHaveCount(0);

    await toggle.click();
    await expect.poll(() => programWrites(mock)).toEqual(['false', 'true']);
    await expect(toggle).toBeChecked();
});

test('the row shows the active level and the next change', async ({ page }) => {
    await openLounge(page);
    await row(page, WITH).click();
    await setMode(page, C.mode.heat);
    await page.keyboard.press('Escape');
    await expect(settings(page)).toHaveCount(0);

    await expect(row(page, WITH).locator('.climate-io__program')).toHaveText(/Level \d|No level now/);
});

test('a program the server withholds hides the switch and the line', async ({ page, mock }) => {
    await mock.send({ op: 'program_clock', hidden: true });
    await openLounge(page);
    await expect(row(page, WITH)).toBeVisible();
    await expect(row(page, WITH).getByRole('switch')).toHaveCount(0);
    await expect(row(page, WITH).locator('.climate-io__program')).toHaveCount(0);
});

test('the settings show the level in force, the next change, and the pause', async ({ page }) => {
    await openLounge(page);
    await row(page, WITH).click();
    await setMode(page, C.mode.heat);

    await expect(section(page).locator('.climate-detail__active')).toHaveText(/Level \d · [\d.]+°|No level now/);
    await expect(section(page).locator('.climate-detail__next')).toHaveText(/\(in .+\)/);

    await section(page).getByRole('switch').click();
    await expect(section(page).locator('.climate-detail__paused')).toContainText(P.paused);
    await expect(section(page).locator('.climate-detail__next')).toHaveCount(0);
});

test('auto mode shows the range, the help, and both strips', async ({ page }) => {
    await openLounge(page);
    await row(page, WITH).click();
    await setMode(page, C.mode.auto);

    await expect(section(page).locator('.climate-detail__fork')).toContainText(/Range \d+(\.\d)?° – \d+(\.\d)?°/);
    const help = section(page).getByRole('button', { name: P.help });
    await expect(help).toHaveAttribute('aria-expanded', 'false');
    await help.click();
    await expect(help).toHaveAttribute('aria-expanded', 'true');
    await expect(section(page).locator('.climate-detail__helptext')).toContainText(/heating stays below cooling/i);

    await expect(section(page).getByRole('group', { name: /Today, Heating/ })).toBeVisible();
    await expect(section(page).getByRole('group', { name: /Today, Cooling/ })).toBeVisible();
});

test('a climate without a program has no switch, no line, no section', async ({ page, mock }) => {
    await openLounge(page);
    await expect(row(page, WITH).getByRole('switch')).toHaveCount(1);
    await expect(row(page, WITHOUT).getByRole('switch')).toHaveCount(0);
    await expect(row(page, WITHOUT).locator('.climate-io__program')).toHaveCount(0);

    await row(page, WITHOUT).click();
    await expect(settings(page)).toBeVisible();
    await expect(section(page)).toHaveCount(0);
    expect(await programWrites(mock)).toEqual([]);
});
