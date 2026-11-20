// The climate program editor against the mock's time programs
// (mock-server/fixtures/program.json): open it from the thermostat's settings,
// edit a slot, copy a day, and see a refused write. Each test leaves a capture
// for the UI review (ARCHI_SHOT=1 keeps them).

import fr from '../app/src/i18n/fr.json';
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
    return `${S.v2.edit} ${start} – ${end}, ${setpoint}°`;
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

/** Presses a stepper of the period view n times. */
async function step(dialog: Locator, field: string, sign: 'plus' | 'minus', n: number): Promise<void> {
    const button = dialog.getByRole('button', { name: `${field} ${S.v2[sign]}`, exact: true });
    for (let i = 0; i < n; i++) await button.click();
}

/** The ranges of every set_timerange the mock saw for one level IO. */
async function writes(mock: MockControl, id: string): Promise<Record<string, string>[][]> {
    return (await mock.log())
        .filter((entry) => entry.frame?.msg === 'set_timerange' && entry.frame.data?.id === id)
        .map((entry) => (entry.frame?.data as unknown as { ranges: Record<string, string>[] }).ranges);
}

/** Waits for the finite animations (the dialog fade), so a capture never shows the list through it. */
async function settle(page: Page): Promise<void> {
    await page.evaluate(() => Promise.all(document.getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined))));
}

/**
 * One capture per theme. The phone project is shot at 390 px, the width the
 * mock-ups were drawn for (a Pixel 7 is 412).
 */
async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
    if (!process.env.ARCHI_SHOT) return;
    const phone = testInfo.project.name === 'mobile-pixel7';
    const format = phone ? 'phone' : 'desktop';
    const size = page.viewportSize();
    if (phone) await page.setViewportSize({ width: 390, height: 844 });
    for (const theme of ['dark', 'light']) {
        await page.evaluate((t) => {
            if (t === 'light') document.documentElement.dataset.theme = 'light';
            else delete document.documentElement.dataset.theme;
        }, theme);
        await page.evaluate(() => document.fonts.ready);
        // The dialog fades in: a capture taken mid-fade shows the list through it.
        await settle(page);
        await page.screenshot({ path: testInfo.outputPath(`${name}-${format}-${theme}.png`), fullPage: true });
    }
    if (size) await page.setViewportSize(size);
}

test.beforeEach(async ({ page, mock }) => {
    await mock.reset();
    // install, not setFixedTime: a frozen Date.now makes Vue skip ancestor handlers of the same event.
    await page.clock.install({ time: new Date(NOW) });
    await page.goto('/');
    await loginAs(page);
});

test('a slot edited in the editor is written, then read back after a reload', async ({ page, mock }, testInfo) => {
    let dialog = await openEditor(page);
    await shot(page, testInfo, 'shot-00-week');
    await openDay(dialog, 'Monday');
    await shot(page, testInfo, 'shot-01-nominal');

    await dialog.getByRole('button', { name: period('06:30', '08:00', '19') }).click();
    await expect(dialog.getByRole('heading', { name: '06:30 – 08:00' })).toBeVisible();
    await shot(page, testInfo, 'shot-02-form');

    await step(dialog, S.form.end, 'plus', 4);
    await expect(dialog.locator('[data-test="end"]')).toHaveText('09:00');
    await dialog.getByRole('button', { name: S.form.save }).click();

    await expect
        .poll(async () => {
            const sent = await writes(mock, HEAT_L1);
            const last = sent.at(-1) ?? [];
            return last.filter((r) => r.start_hour === '6' && r.end_hour === '9').map((r) => r.day).sort();
        })
        .toEqual(['1']);
    await expect(dialog.getByRole('button', { name: period('06:30', '09:00', '19') })).toBeVisible();

    await page.reload();
    await loginAs(page, undefined, /#\/home/);
    dialog = await openEditor(page);
    await openDay(dialog, 'Monday');
    await expect(dialog.getByRole('button', { name: period('06:30', '09:00', '19') })).toBeVisible();
    await expect(dialog.getByRole('button', { name: period('17:30', '22:30', '19') })).toBeVisible();

    await dialog.getByRole('button', { name: S.week, exact: true }).click();
    // The seeded cooling program has nothing on weekdays.
    await dialog.getByRole('tab', { name: /^Cooling/ }).click();
    await openDay(dialog, 'Monday');
    await expect(dialog.getByText(S.v2.emptyTitle)).toBeVisible();
    await shot(page, testInfo, 'shot-01b-empty-day');
});

/** The copy sheet: pick days, then submit (a second press confirms the replacement). */
async function copyTo(dialog: Locator, from: string, days: string[]): Promise<Locator> {
    await dialog.getByRole('button', { name: S.copy.open }).click();
    const sheet = dialog.getByRole('dialog', { name: `Copy ${from} to` });
    for (const d of days) await sheet.getByRole('button', { name: d, exact: true }).click();
    await sheet.getByRole('button', { name: /^Copy to \d/ }).click();
    return sheet;
}

test('copying a day over one that has slots asks first, then replaces them', async ({ page, mock }, testInfo) => {
    const dialog = await openEditor(page);
    await openDay(dialog, 'Monday');
    const sheet = await copyTo(dialog, 'Monday', ['Saturday']);
    await expect(sheet.getByRole('alert')).toContainText('Saturday');
    await shot(page, testInfo, 'shot-03-copy-confirm');

    await sheet.getByRole('button', { name: S.copy.replace }).click();
    await expect.poll(async () => (await writes(mock, HEAT_L1)).length).toBeGreaterThan(0);
    await expect(sheet).toHaveCount(0);

    await dialog.getByRole('button', { name: S.week, exact: true }).click();
    await openDay(dialog, 'Saturday');
    await expect(dialog.getByRole('button', { name: period('06:30', '08:00', '19') })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Edit / })).toHaveCount(2);
    await shot(page, testInfo, 'shot-04-copied');
});

test('a service session is told it cannot change the program, here and when the editor is reopened', async ({ page, mock }, testInfo) => {
    await mock.send({ op: 'program_scope' });
    let dialog = await openEditor(page);
    await openDay(dialog, 'Monday');
    const sheet = await copyTo(dialog, 'Monday', ['Saturday']);
    await sheet.getByRole('button', { name: S.copy.replace }).click();
    await expect(dialog.getByText(S.serviceReadOnly)).toBeVisible();
    await expect(dialog.locator('.schedule__banner')).toHaveCount(0);
    await expect(sheet).toHaveCount(0);
    await shot(page, testInfo, 'shot-19a-service-readonly-day');

    await dialog.getByRole('button', { name: S.v2.close }).click();
    await expect(editor(page)).toHaveCount(0);
    await page.locator('.climate-detail').getByRole('button', { name: S.edit }).click();
    dialog = editor(page);
    await expect(dialog.getByText(S.serviceReadOnly)).toBeVisible();
    await shot(page, testInfo, 'shot-19b-service-readonly-week');
});

test('a copy to two days that fails halfway stays open; the retry copies to both', async ({ page, mock }, testInfo) => {
    const dialog = await openEditor(page);
    await openDay(dialog, 'Monday');
    await mock.send({ op: 'timerange_fail', after: 0 });
    const sheet = await copyTo(dialog, 'Monday', ['Saturday', 'Sunday']);
    await sheet.getByRole('button', { name: S.copy.replace }).click();
    await expect(sheet.getByRole('alert').filter({ hasText: S.copy.failed })).toBeVisible();
    await shot(page, testInfo, 'shot-12b-copy-retry');

    // The sheet stays open on the same choice: pressing it again sends the same copy.
    await sheet.getByRole('button', { name: S.copy.replace }).click();
    await expect(sheet).toHaveCount(0);
    await page.reload();
    await loginAs(page, undefined, /#\/home/);
    const again = await openEditor(page);
    for (const d of ['Saturday', 'Sunday']) {
        await openDay(again, d);
        await expect(again.getByRole('button', { name: period('06:30', '08:00', '19') })).toBeVisible();
        await expect(again.getByRole('button', { name: /^Edit / })).toHaveCount(2);
        await again.getByRole('button', { name: S.week, exact: true }).click();
    }
});

test('a write the server could not save shows an alert with a retry, and the editor re-reads', async ({ page, mock }, testInfo) => {
    const dialog = await openEditor(page);
    await openDay(dialog, 'Monday');
    await mock.send({ op: 'timerange_fail' });

    await dialog.getByRole('button', { name: period('17:30', '22:30', '19') }).click();
    await step(dialog, S.form.start, 'plus', 2);
    await dialog.getByRole('button', { name: S.form.save }).click();

    const alert = dialog.getByRole('alert').filter({ hasText: S.error.notWritten });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole('button', { name: S.retry })).toBeVisible();
    // The view stays open with its draft: closing it would look like a save.
    await expect(dialog.getByRole('heading', { name: '17:30 – 22:30' })).toBeVisible();
    await expect(dialog.locator('[data-test="start"]')).toHaveText('18:00');
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

    const add = async (hour: number, setpoint: number): Promise<void> => {
        await addSlot.click();
        await step(dialog, S.form.start, 'minus', 32 - hour * 4);
        await step(dialog, S.form.end, 'minus', 36 - hour * 4);
        const target = dialog.locator('[data-test="setpoint"]');
        while (!(await target.innerText()).startsWith(String(setpoint))) {
            await step(dialog, S.form.setpoint, 'plus', 2);
        }
        await dialog.getByRole('button', { name: S.form.save }).click();
    };
    await add(1, 22);
    await add(2, 23);
    await add(3, 24);
    await expect(dialog.getByRole('button', { name: period('01:00', '02:00', '22') })).toBeVisible();
    await shot(page, testInfo, 'shot-10-six-levels');

    const before = (await mock.log()).length;
    await addSlot.click();
    await step(dialog, S.form.setpoint, 'plus', 16);
    const refused = S.tooMany.replace('{n}', '6');
    await expect(dialog.getByRole('alert').filter({ hasText: refused })).toBeVisible();
    await expect(dialog.getByRole('button', { name: S.form.save })).toBeDisabled();
    expect((await mock.log()).length).toBe(before);
    await shot(page, testInfo, 'shot-09-seventh-refused');
});

test('the week has no editable bar; a row opens its day; the back button and Escape return to the week', async ({ page }, testInfo) => {
    const dialog = await openEditor(page);
    await expect(dialog.getByRole('heading', { name: 'Monday' })).toHaveCount(0);
    await expect(dialog.getByRole('heading', { name: '06:30 – 08:00' })).toHaveCount(0);

    await openDay(dialog, 'Monday');
    await expect(dialog.getByText(/\d+ periods/).first()).toBeVisible();
    await dialog.getByRole('button', { name: period('06:30', '08:00', '19') }).click();
    await expect(dialog.getByRole('heading', { name: '06:30 – 08:00' })).toBeVisible();

    // Escape goes back one view at a time and never closes the dialog from inside it.
    await page.keyboard.press('Escape');
    await expect(dialog.getByRole('heading', { name: 'Monday' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog.getByRole('button', { name: /^Monday, Heating/ })).toBeVisible();
    await expect(dialog).toBeVisible();
    await openDay(dialog, 'Tuesday');
    await dialog.getByRole('button', { name: S.week, exact: true }).click();
    await expect(dialog.getByRole('button', { name: /^Tuesday, Heating/ })).toBeVisible();
    await shot(page, testInfo, 'shot-13-back');
    await expect(page.locator(':focus')).toHaveClass(/week__row/);
});

test('copying is unavailable on an empty day; a copy that fails is reported as incomplete', async ({ page, mock }, testInfo) => {
    const dialog = await openEditor(page);
    await dialog.getByRole('tab', { name: /^Cooling/ }).click();
    await openDay(dialog, 'Monday');
    await expect(dialog.getByRole('button', { name: S.copy.open })).toBeDisabled();
    await shot(page, testInfo, 'shot-11-nothing-to-copy');

    await dialog.getByRole('button', { name: S.week, exact: true }).click();
    await dialog.getByRole('tab', { name: /^Heating/ }).click();
    await openDay(dialog, 'Saturday');
    await mock.send({ op: 'timerange_fail' });
    const sheet = await copyTo(dialog, 'Saturday', ['Sunday']);
    await sheet.getByRole('button', { name: S.copy.replace }).click();
    await expect(dialog.getByText(S.copy.failed).first()).toBeVisible();
    await shot(page, testInfo, 'shot-12-copy-incomplete');
});

test('a period that crosses midnight is saved as two ranges', async ({ page, mock }, testInfo) => {
    const dialog = await openEditor(page);
    await openDay(dialog, 'Monday');
    await dialog.getByRole('button', { name: S.addSlot, exact: true }).last().click();
    // 08:00 → 23:00, then the end goes past midnight to 00:30.
    await step(dialog, S.form.start, 'plus', 60);
    await step(dialog, S.form.end, 'plus', 58);
    await expect(dialog.locator('[data-test="next-day"]')).toBeVisible();
    await expect(dialog.getByRole('status').filter({ hasText: '24:00' })).toBeVisible();
    await shot(page, testInfo, 'shot-14-midnight');
    await dialog.getByRole('button', { name: S.form.save }).click();
    await expect.poll(async () => (await mock.log()).filter((e) => e.frame?.msg === 'set_timerange').length).toBeGreaterThan(0);
    const sent = (await mock.log()).filter((e) => e.frame?.msg === 'set_timerange').flatMap((e) => (e.frame?.data as unknown as { ranges: Record<string, string>[] }).ranges);
    expect(sent.some((r) => r.day === '1' && r.start_hour === '23' && r.end_hour === '23' && r.end_min === '59')).toBe(true);
    expect(sent.some((r) => r.day === '2' && r.start_hour === '0' && r.end_hour === '0' && r.end_min === '30')).toBe(true);
});

test('a period is deleted only after a confirmation', async ({ page, mock }, testInfo) => {
    const dialog = await openEditor(page);
    await openDay(dialog, 'Monday');
    await dialog.getByRole('button', { name: period('17:30', '22:30', '19') }).click();
    await dialog.getByRole('button', { name: S.form.delete }).click();
    const confirm = dialog.getByRole('alertdialog');
    await expect(confirm).toBeVisible();
    await shot(page, testInfo, 'shot-15-delete-confirm');
    const before = (await mock.log()).length;
    await confirm.getByRole('button', { name: S.form.cancel }).click();
    expect((await mock.log()).length).toBe(before);

    await dialog.getByRole('button', { name: S.form.delete }).click();
    await dialog.getByRole('alertdialog').getByRole('button', { name: S.form.delete }).click();
    await expect(dialog.getByRole('button', { name: period('17:30', '22:30', '19') })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: period('06:30', '08:00', '19') })).toBeVisible();
});

test('swapping two overlapping periods that fails halfway keeps the view open; the retry finishes the same swap', async ({ page, mock }, testInfo) => {
    const dialog = await openEditor(page);
    await openDay(dialog, 'Monday');
    await dialog.getByRole('button', { name: S.addSlot, exact: true }).last().click();
    // 07:00-10:00 at 21 overlaps the 06:30-08:00 period at 19.
    await step(dialog, S.form.start, 'minus', 4);
    await step(dialog, S.form.setpoint, 'plus', 8);
    const overlap = dialog.locator('[data-test="overlap"]');
    await expect(overlap).toBeVisible();
    await overlap.getByRole('button', { name: S.v2.swap }).click();
    await expect(dialog.locator('[data-test="track-overlap"]')).toBeVisible();
    await shot(page, testInfo, 'shot-16-overlap-swapped');

    // The first range write succeeds, the second one is refused.
    await mock.send({ op: 'timerange_fail', after: 1 });
    await dialog.getByRole('button', { name: S.form.save }).click();
    const alert = dialog.getByRole('alert').filter({ hasText: S.error.notWritten });
    await expect(alert).toBeVisible();
    await expect(dialog.getByRole('heading', { name: S.addSlot, exact: true })).toBeVisible();
    await alert.getByRole('button', { name: S.retry }).click();
    await expect(dialog.getByRole('heading', { name: S.addSlot, exact: true })).toHaveCount(0);

    // After the retry the server holds the swap exactly once: level 1 now carries the 21 degree period.
    const all = (await mock.log()).filter((e) => e.frame?.msg === 'set_timerange').flatMap((e) => (e.frame?.data as unknown as { ranges: Record<string, string>[] }).ranges);
    expect(all.some((r) => r.day === '1' && r.start_hour === '7' && r.end_hour === '10')).toBe(true);
    await page.reload();
    await loginAs(page, undefined, /#\/home/);
    const again = await openEditor(page);
    await openDay(again, 'Monday');
    await expect(again.getByRole('button', { name: period('07:00', '10:00', '21') })).toBeVisible();
    await expect(again.getByRole('button', { name: period('06:30', '08:00', '19') })).toBeVisible();
    await expect(again.getByRole('button', { name: /^Edit / })).toHaveCount(3);
});

test('the program paused and the connection lost are shown in the editor', async ({ page, mock }, testInfo) => {
    await page.locator('.room-tile').nth(LOUNGE).click();
    await page.locator('.io-row').filter({ has: page.locator('.io-row__name', { hasText: THERMOSTAT }) }).click();
    await page.locator('.climate-detail').getByRole('switch').click();
    await expect(page.locator('.climate-detail__paused')).toBeVisible();
    await page.locator('.climate-detail').getByRole('button', { name: S.edit }).click();
    const dialog = editor(page);
    await expect(dialog.getByRole('button', { name: /^Monday, Heating/ })).toBeVisible();
    await shot(page, testInfo, 'shot-17-paused');

    await mock.drop();
    await expect(dialog.getByText(S.readOnly)).toBeVisible();
    await openDay(dialog, 'Monday');
    await expect(dialog.getByRole('button', { name: S.addSlot, exact: true })).toBeDisabled();
    await shot(page, testInfo, 'shot-18-offline');
});

test('every control of the editor is at least 44 px and shows a focus ring', async ({ page }) => {
    const dialog = await openEditor(page);
    const check = async (): Promise<void> => {
        // The dialog fades in with a transform: measured mid-animation a 44 px box reads 43.99997.
        await settle(page);
        const controls = dialog.locator('button:visible, [role="tab"]:visible');
        const n = await controls.count();
        for (let i = 0; i < n; i++) {
            const box = await controls.nth(i).boundingBox();
            const name = await controls.nth(i).innerText();
            expect(box && Math.round(box.width) >= 44 && Math.round(box.height) >= 44, `${name.trim() || i}: ${box?.width}x${box?.height}`).toBe(true);
        }
    };
    await check();
    await openDay(dialog, 'Monday');
    await check();
    await dialog.getByRole('button', { name: period('06:30', '08:00', '19') }).click();
    await check();

    // Tab away from the back button: the element that gets focus draws an outline.
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveCSS('outline-style', 'solid');
});

test('the period form fits the dialog at 390 and 1280 px, error message included', async ({ page }) => {
    const dialog = await openEditor(page);
    await openDay(dialog, 'Monday');
    await dialog.getByRole('button', { name: S.addSlot, exact: true }).last().click();
    // Start equals end: the range error appears under the fields.
    const error = dialog.getByRole('alert').filter({ hasText: S.v2.rangeError });
    for (let i = 0; i < 96 && !(await error.isVisible()); i++) await step(dialog, S.form.end, 'minus', 1);
    await expect(error).toBeVisible();
    for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        await settle(page);
        const clipped = await dialog.evaluate((box) => {
            // The period view's own box: the dialog's padding would hide an overflow.
            const bounds = (box.querySelector('.period') ?? box).getBoundingClientRect();
            const out: string[] = [];
            for (const el of box.querySelectorAll<HTMLElement>('.period button, .period output, .period__label, .period__note, .period__field')) {
                const r = el.getBoundingClientRect();
                if (r.width === 0) continue;
                if (r.left < bounds.left - 0.5 || r.right > bounds.right + 0.5) out.push(`${el.className} ${Math.round(r.left)}..${Math.round(r.right)} in ${Math.round(bounds.left)}..${Math.round(bounds.right)}`);
                if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') out.push(`${el.className} text cut`);
            }
            return out;
        });
        expect(clipped, `${width}px`).toEqual([]);
    }
});

test.describe('french captures', () => {
    test.use({ locale: 'fr-FR' });

    test('the week, a day and the copy sheet read in french', async ({ page }, testInfo) => {
        const tile = page.locator('.room-tile').nth(LOUNGE);
        if (await tile.isVisible()) await tile.click();
        await page.locator('.io-row').filter({ has: page.locator('.io-row__name', { hasText: THERMOSTAT }) }).click();
        await shot(page, testInfo, 'shot-20a-fr-detail');
        await page.locator('.climate-detail').getByRole('button', { name: fr.schedule.edit }).click();
        const dialog = editor(page);
        await dialog.locator('.week__row').first().click();
        await shot(page, testInfo, 'shot-20b-fr-day');
        await dialog.getByRole('button', { name: fr.schedule.copy.open }).click();
        await dialog.locator('.sheet__day').nth(1).click();
        await shot(page, testInfo, 'shot-20c-fr-copy');
    });
});
