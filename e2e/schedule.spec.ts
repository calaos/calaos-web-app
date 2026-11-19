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

/** The accessible name of a period row in the day list. */
function period(start: string, end: string, setpoint: string): string {
    return `${S.edit} ${start} – ${end}, ${setpoint}°`;
}

function editor(page: Page): Locator {
    return page.getByRole('dialog').filter({ has: page.locator('.schedule') });
}

async function openEditor(page: Page): Promise<Locator> {
    // A reload lands back in the room it was in.
    const tile = page.locator('.room-tile').nth(LOUNGE);
    if (await tile.isVisible()) await tile.click();
    await page.locator('.io-row').filter({ has: page.locator('.io-row__name', { hasText: THERMOSTAT }) }).click();
    await page.locator('.climate-detail').getByRole('button', { name: S.edit }).click();
    const dialog = editor(page);
    await expect(dialog.getByRole('button', { name: /^Monday, Heating/ })).toBeVisible();
    return dialog;
}

/** Week → Day: the day list of one day. */
async function openDay(dialog: Locator, name: string): Promise<void> {
    await dialog.getByRole('button', { name: new RegExp(`^${name}, `) }).click();
    await expect(dialog.getByRole('heading', { name })).toBeVisible();
}

/** The ranges of every set_timerange the mock saw for one level IO. */
async function writes(mock: MockControl, id: string): Promise<Record<string, string>[][]> {
    return (await mock.log())
        .filter((entry) => entry.frame?.msg === 'set_timerange' && entry.frame.data?.id === id)
        .map((entry) => (entry.frame?.data as unknown as { ranges: Record<string, string>[] }).ranges);
}

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
    await page.evaluate(() => document.fonts.ready);
    // The dialog fades in: a capture taken mid-fade shows the list through it.
    await page.evaluate(() => Promise.all(document.getAnimations()
                .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
                .map((a) => a.finished.catch(() => undefined))));
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
}

test.beforeEach(async ({ page, mock }) => {
    await mock.reset();
    await page.clock.setFixedTime(NOW);
    await page.goto('/');
    await loginAs(page);
});

test('a slot edited in the editor is written, then read back after a reload', async ({ page, mock }, testInfo) => {
    let dialog = await openEditor(page);
    await shot(page, testInfo, 'shot-00-week');
    await openDay(dialog, 'Monday');
    await shot(page, testInfo, 'shot-01-nominal');

    await dialog.getByRole('button', { name: period('06:30', '08:00', '19') }).click();
    await expect(dialog.getByRole('heading', { name: S.form.edit })).toBeVisible();
    // The form edits the slot of the day being shown; other days are opt-in.
    await expect(dialog.getByRole('button', { name: 'Monday', pressed: true, exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Tuesday', pressed: false, exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Tuesday', exact: true }).click();
    await shot(page, testInfo, 'shot-02-form');

    await dialog.getByLabel(S.form.end).fill('09:00');
    await dialog.getByRole('button', { name: S.form.save }).click();

    await expect
        .poll(async () => {
            const sent = await writes(mock, HEAT_L1);
            const last = sent.at(-1) ?? [];
            return last.filter((r) => r.start_hour === '6' && r.end_hour === '9').map((r) => r.day).sort();
        })
        .toEqual(['1', '2']);
    await expect(dialog.getByRole('button', { name: period('06:30', '09:00', '19') })).toBeVisible();

    await page.reload();
    await loginAs(page, undefined, /#\/home/);
    dialog = await openEditor(page);
    await openDay(dialog, 'Monday');
    await expect(dialog.getByRole('button', { name: period('06:30', '09:00', '19') })).toBeVisible();
    await expect(dialog.getByRole('button', { name: period('17:30', '22:30', '19') })).toBeVisible();
});

test('copying a day over one that has slots asks first, then replaces them', async ({ page, mock }, testInfo) => {
    const dialog = await openEditor(page);
    await openDay(dialog, 'Monday');
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

    await dialog.getByRole('button', { name: S.week }).click();
    await openDay(dialog, 'Saturday');
    await expect(dialog.getByRole('button', { name: period('06:30', '08:00', '19') })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Edit / })).toHaveCount(2);
    await shot(page, testInfo, 'shot-04-copied');
});

test('a write the server could not save shows an alert with a retry, and the editor re-reads', async ({ page, mock }, testInfo) => {
    const dialog = await openEditor(page);
    await openDay(dialog, 'Monday');
    await mock.send({ op: 'timerange_fail' });

    await dialog.getByRole('button', { name: period('17:30', '22:30', '19') }).click();
    await dialog.getByLabel(S.form.start).fill('18:00');
    await dialog.getByRole('button', { name: S.form.save }).click();

    const alert = dialog.getByRole('alert').filter({ hasText: S.error.notWritten });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole('button', { name: S.retry })).toBeVisible();
    await shot(page, testInfo, 'shot-05-not-written');
});

test('cooling tab: switching the cool off outside slots is written and the gap reads Off', async ({ page, mock }, testInfo) => {
    const dialog = await openEditor(page);
    await dialog.getByRole('tab', { name: /^Cooling/ }).click();
    await shot(page, testInfo, 'shot-06-cool');
    await openDay(dialog, 'Monday');

    await dialog.getByRole('checkbox', { name: S.coolOff }).check();
    await expect
        .poll(async () =>
            (await mock.log())
                .filter((e) => e.frame?.msg === 'set_state' && e.frame.data?.id === 'thermo_bureau_cool_default_off')
                .map((e) => e.frame?.data?.value),
        )
        .toEqual(['true']);
    await shot(page, testInfo, 'shot-07-cool-off');
});

test('the seventh temperature is refused with a message and nothing is written', async ({ page, mock }, testInfo) => {
    const dialog = await openEditor(page);
    await openDay(dialog, 'Monday');
    const addSlot = dialog.getByRole('button', { name: S.addSlot, exact: true }).last();

    const add = async (hour: number, setpoint: string): Promise<void> => {
        await addSlot.click();
        await dialog.getByLabel(S.form.start).fill(`${String(hour).padStart(2, '0')}:00`);
        await dialog.getByLabel(S.form.end).fill(`${String(hour + 1).padStart(2, '0')}:00`);
        await dialog.getByLabel(S.form.setpoint).first().fill(setpoint);
        await dialog.getByRole('button', { name: S.form.save }).click();
    };
    await add(1, '22');
    await add(2, '23');
    await add(3, '24');
    await expect(dialog.getByRole('button', { name: period('01:00', '02:00', '22') })).toBeVisible();
    await shot(page, testInfo, 'shot-10-six-levels');

    const before = (await mock.log()).length;
    await addSlot.click();
    await dialog.getByLabel(S.form.start).fill('04:00');
    await dialog.getByLabel(S.form.end).fill('05:00');
    await dialog.getByLabel(S.form.setpoint).first().fill('25');
    await dialog.getByRole('button', { name: S.form.save }).click();
    await expect(dialog.getByRole('alert').filter({ hasText: S.tooMany.replace('{n}', '6').replace('{dir}', S.heat) })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: S.form.new })).toBeVisible();
    expect((await mock.log()).length).toBe(before);
    await dialog.getByRole('button', { name: S.form.save }).scrollIntoViewIfNeeded();
    await shot(page, testInfo, 'shot-09-seventh-refused');
});

test('clicking a bar opens nothing; a row opens its day; the back button and Escape return to the week', async ({ page }, testInfo) => {
    const dialog = await openEditor(page);
    await dialog.locator('.track').first().click({ position: { x: 5, y: 5 } });
    await expect(dialog.getByRole('heading', { name: 'Monday' })).toHaveCount(0);
    await expect(dialog.getByRole('heading', { name: S.form.edit })).toHaveCount(0);

    await openDay(dialog, 'Monday');
    await expect(dialog.getByText(/\d+ periods/).first()).toBeVisible();
    await dialog.getByRole('button', { name: period('06:30', '08:00', '19') }).click();
    await expect(dialog.getByRole('heading', { name: S.form.edit })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog.getByRole('button', { name: /^Monday, Heating/ })).toBeVisible();
    await expect(dialog).toBeVisible();
    await openDay(dialog, 'Tuesday');
    await dialog.getByRole('button', { name: S.week }).click();
    await expect(dialog.getByRole('button', { name: /^Tuesday, Heating/ })).toBeVisible();
    await shot(page, testInfo, 'shot-13-back');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
});

test('copying is unavailable on an empty day; a copy that fails is reported as incomplete', async ({ page, mock }, testInfo) => {
    const dialog = await openEditor(page);
    await dialog.getByRole('tab', { name: /^Cooling/ }).click();
    await openDay(dialog, 'Monday');
    await expect(dialog.getByRole('button', { name: S.copy.open })).toBeDisabled();
    await shot(page, testInfo, 'shot-11-nothing-to-copy');

    await dialog.getByRole('button', { name: S.week }).click();
    await dialog.getByRole('tab', { name: /^Heating/ }).click();
    await openDay(dialog, 'Saturday');
    await dialog.getByRole('button', { name: S.copy.open }).click();
    await mock.send({ op: 'timerange_fail' });
    const panel = dialog.getByRole('region', { name: 'Copy Saturday to' });
    await panel.getByRole('button', { name: 'Sunday' }).click();
    await panel.getByRole('button', { name: S.copy.submit }).click();
    await dialog.getByRole('alertdialog', { name: S.copy.confirmTitle }).getByRole('button', { name: S.copy.replace }).click();
    await expect(dialog.getByText(S.copy.failed)).toBeVisible();
    await shot(page, testInfo, 'shot-12-copy-incomplete');
});
