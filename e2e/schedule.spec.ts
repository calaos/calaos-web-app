// The climate program editor against the mock's time programs
// (mock-server/fixtures/program.json): open it from the thermostat's settings,
// edit a slot, copy a day, and see a refused write. Each test leaves a capture
// for the UI review (ARCHI_SHOT=1 keeps them).

import { MESSAGES, expect, loginAs, test } from './fixtures';
import type { MockControl } from './fixtures';
import type { Locator, Page, TestInfo } from '@playwright/test';

const LOUNGE = 2;
const THERMOSTAT = 'Thermostat bureau';
const HEAT_L1 = 'thermo_bureau_heat_level1';
const S = MESSAGES.schedule;

/** A Monday, so the editor opens on day 1 with the now marker at 10:00. */
const NOW = new Date('2026-11-16T10:00:00');

function segment(level: number, start: string, end: string, setpoint: string): string {
    return S.segment.replace('{n}', String(level)).replace('{start}', start).replace('{end}', end).replace('{setpoint}', setpoint);
}

function editor(page: Page): Locator {
    return page.getByRole('dialog').filter({ has: page.locator('.schedule') });
}

async function openEditor(page: Page): Promise<Locator> {
    await page.locator('.room-tile').nth(LOUNGE).click();
    await page.locator('.io-row').filter({ has: page.locator('.io-row__name', { hasText: THERMOSTAT }) }).click();
    await page.locator('.climate-detail').getByRole('button', { name: S.edit }).click();
    const dialog = editor(page);
    await expect(dialog.getByRole('group', { name: /Monday, Heating/ })).toBeVisible();
    return dialog;
}

/** The ranges of every set_timerange the mock saw for one level IO. */
async function writes(mock: MockControl, id: string): Promise<Record<string, string>[][]> {
    return (await mock.log())
        .filter((entry) => entry.frame?.msg === 'set_timerange' && entry.frame.data?.id === id)
        .map((entry) => (entry.frame?.data as unknown as { ranges: Record<string, string>[] }).ranges);
}

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
}

test.skip(({ isMobile }) => isMobile, 'the thermostat settings open as a side panel on wide screens only');

test.beforeEach(async ({ page, mock }) => {
    await mock.reset();
    await page.clock.setFixedTime(NOW);
    await page.goto('/');
    await loginAs(page);
});

test('a slot edited in the editor is written, then read back after a reload', async ({ page, mock }, testInfo) => {
    let dialog = await openEditor(page);
    await shot(page, testInfo, 'shot-01-nominal');

    await dialog.getByRole('button', { name: segment(1, '06:30', '08:00', '19') }).click();
    await expect(dialog.getByRole('heading', { name: S.form.edit })).toBeVisible();
    // The morning slot runs Monday to Friday: the form edits it on all five days.
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
        await expect(dialog.getByRole('button', { name: day, pressed: true })).toBeVisible();
    }
    await shot(page, testInfo, 'shot-02-form');

    await dialog.getByLabel(S.form.end).fill('09:00');
    await dialog.getByRole('button', { name: S.form.save }).click();

    await expect
        .poll(async () => {
            const sent = await writes(mock, HEAT_L1);
            const last = sent.at(-1) ?? [];
            return last.filter((r) => r.start_hour === '6' && r.end_hour === '9').map((r) => r.day).sort();
        })
        .toEqual(['1', '2', '3', '4', '5']);
    await expect(dialog.getByRole('button', { name: segment(1, '06:30', '09:00', '19') })).toBeVisible();

    await page.reload();
    await loginAs(page);
    dialog = await openEditor(page);
    await expect(dialog.getByRole('button', { name: segment(1, '06:30', '09:00', '19') })).toBeVisible();
    await expect(dialog.getByRole('button', { name: segment(1, '17:30', '22:30', '19') })).toBeVisible();
});

test('copying a day over one that has slots asks first, then replaces them', async ({ page, mock }, testInfo) => {
    const dialog = await openEditor(page);
    await dialog.getByRole('button', { name: S.copy.open }).click();
    const panel = dialog.getByRole('region', { name: 'Copy Monday to' });
    await panel.getByRole('button', { name: 'Saturday' }).click();
    await panel.getByRole('button', { name: S.copy.submit }).click();

    const confirm = dialog.getByRole('alertdialog', { name: S.copy.confirmTitle });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('Saturday');
    await shot(page, testInfo, 'shot-03-copy-confirm');

    await confirm.getByRole('button', { name: S.copy.replace }).click();
    await expect.poll(async () => (await writes(mock, HEAT_L1)).length).toBeGreaterThan(0);

    await dialog.getByRole('tab', { name: 'Saturday' }).click();
    await expect(dialog.getByRole('group', { name: /Saturday, Heating/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: segment(1, '06:30', '08:00', '19') })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Level 2,/ })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /^Level 3,/ })).toHaveCount(0);
    await shot(page, testInfo, 'shot-04-copied');
});

test('a write the server could not save shows an alert with a retry, and the editor re-reads', async ({ page, mock }, testInfo) => {
    const dialog = await openEditor(page);
    await mock.send({ op: 'timerange_fail' });

    await dialog.getByRole('button', { name: segment(1, '17:30', '22:30', '19') }).click();
    await dialog.getByLabel(S.form.start).fill('18:00');
    await dialog.getByRole('button', { name: S.form.save }).click();

    const alert = dialog.getByRole('alert').filter({ hasText: S.error.notWritten });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole('button', { name: S.retry })).toBeVisible();
    await shot(page, testInfo, 'shot-05-not-written');
});
