// The climate widget against the mock's climate fixtures, from the tap to the
// wire and back.
//
// Each device in mock-server/fixtures/home.json is a different capability
// combination, so the widget's "only what the device has" rule is exercised
// end to end rather than by one lucky fixture:
//   clim_salon     everything (six modes, range with min_range, fan, swing, action)
//   thermo_sdb     heat-only thermostat: two modes, one setpoint, no fan
//   thermo_bureau  thermostat with a range
//   clim_split     range-only proxy with a fan, no action
//   clim_fancoil   single setpoint, swing only, no action
//   clim_garage    mode only, mode unknown at start

import { MESSAGES, expect, loginAs, test } from './fixtures';
import type { MockControl } from './fixtures';
import type { Locator, Page } from '@playwright/test';

/** Room ids are indices into the hits-desc room list (see home-rooms.spec). */
const LOUNGE = 2;

/** Quiet period of the widget's debounce; polls below simply outwait it. */
const DEBOUNCE_MS = 350;

const SALON = 'Climatisation salon';

function copy(template: string, name: string): string {
    return template.replace('{name}', name);
}

function device(page: Page, name: string): Locator {
    return page.locator('.io-row').filter({ has: page.locator('.io-row__name', { hasText: name }) });
}

function mode(row: Locator, label: string): Locator {
    return row.locator('.climate-io__mode', { hasText: new RegExp(`^${label}$`) });
}

function targetSlider(row: Locator, name: string): Locator {
    return row.getByRole('slider', { name: copy(MESSAGES.climate.target, name), exact: true });
}

async function openLounge(page: Page): Promise<void> {
    await page.goto('/');
    await loginAs(page);
    await page.locator('.room-tile').nth(LOUNGE).click();
    await expect(page).toHaveURL(new RegExp(`#/home/${LOUNGE}$`));
}

/** The `value` of every set_state frame the mock saw for one device. */
async function commands(mock: MockControl, id: string): Promise<string[]> {
    return (await mock.log())
        .filter((entry) => entry.frame?.msg === 'set_state' && entry.frame.data?.id === id)
        .map((entry) => entry.frame?.data?.value ?? '');
}

test.beforeEach(async ({ mock }) => {
    await mock.reset();
});

test('changing the mode sends the plain mode and the buttons follow the answer', async ({ page, mock }) => {
    await openLounge(page);
    const row = device(page, SALON);
    await expect(mode(row, MESSAGES.climate.mode.cool)).toHaveAttribute('aria-pressed', 'true');

    await mock.latency(1000);
    await mode(row, MESSAGES.climate.mode.heat).click();

    await expect.poll(() => commands(mock, 'clim_salon')).toEqual(['heat']);
    // Not optimistic: the old mode stays pressed while the answer is out.
    await expect(row).toHaveAttribute('aria-busy', 'true');
    await expect(mode(row, MESSAGES.climate.mode.cool)).toHaveAttribute('aria-pressed', 'true');

    await expect(mode(row, MESSAGES.climate.mode.heat)).toHaveAttribute('aria-pressed', 'true');
    await expect(row).not.toHaveAttribute('aria-busy', 'true');
    // Current 23.4 above the 21 target: heating has nothing to do.
    await expect(row.locator('.climate-io__chip')).toHaveText(MESSAGES.climate.action.idle);
});

test('moving the setpoint by keyboard sends one JSON command and shows the update', async ({ page, mock }) => {
    await openLounge(page);
    const row = device(page, 'Thermostat salle de bain');
    const slider = targetSlider(row, 'Thermostat salle de bain');
    await expect(row.locator('.climate-io__target')).toHaveText('21.5 °C');

    // Three quick steps are one gesture to the server.
    await slider.focus();
    await slider.press('ArrowRight');
    await slider.press('ArrowRight');
    await slider.press('ArrowRight');
    await expect(row.locator('.climate-io__target')).toHaveText('23.0 °C');

    await expect.poll(() => commands(mock, 'thermo_sdb'), { timeout: DEBOUNCE_MS * 10 }).toEqual([
        '{"target_temp":23}',
    ]);
    // The answer replaced the device: the update is the server's, and 23 °C
    // above the 19.5 °C reading means the thermostat is heating.
    await expect(row).not.toHaveAttribute('aria-busy', 'true');
    await expect(row.locator('.climate-io__target')).toHaveText('23.0 °C');
    await expect(row.locator('.climate-io__chip')).toHaveText(MESSAGES.climate.action.heating);
});

test('dragging the slider with the pointer sends a single command', async ({ page, mock }) => {
    await openLounge(page);
    const row = device(page, SALON);
    const slider = targetSlider(row, SALON);
    // The room is long: bring the slider clear of the fixed footer first.
    await slider.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const box = (await slider.boundingBox())!;

    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 8 });
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect.poll(() => commands(mock, 'clim_salon')).toHaveLength(1);
    const [only] = await commands(mock, 'clim_salon');
    expect(JSON.parse(only)).toEqual({ target_temp: expect.any(Number) });
    await page.waitForTimeout(DEBOUNCE_MS * 2);
    expect(await commands(mock, 'clim_salon')).toHaveLength(1);
});

test('off greys the setpoint, fan and swing; auto swaps the slider for a range that keeps its gap', async ({
    page,
    mock,
}) => {
    await openLounge(page);
    const row = device(page, SALON);

    await mode(row, MESSAGES.climate.mode.off).click();
    await expect(mode(row, MESSAGES.climate.mode.off)).toHaveAttribute('aria-pressed', 'true');
    await expect(targetSlider(row, SALON)).toBeDisabled();
    await expect(row.getByRole('combobox')).toHaveCount(2);
    for (const select of await row.getByRole('combobox').all()) await expect(select).toBeDisabled();

    await mode(row, MESSAGES.climate.mode.auto).click();
    await expect(mode(row, MESSAGES.climate.mode.auto)).toHaveAttribute('aria-pressed', 'true');
    await expect(row.getByRole('slider')).toHaveCount(2);
    await expect(row.locator('.climate-io__target')).toHaveText('19.0 – 24.0 °C');

    // End asks for 30; the gap to the 24 °C high handle stops it at 22.
    const low = row.getByRole('slider', { name: copy(MESSAGES.climate.targetLow, SALON), exact: true });
    await low.focus();
    await low.press('End');
    await expect(low).toHaveValue('22');

    await expect.poll(() => commands(mock, 'clim_salon')).toEqual([
        'off',
        'auto',
        '{"target_temp_low":22,"target_temp_high":24}',
    ]);
    await expect(row.locator('.climate-io__target')).toHaveText('22.0 – 24.0 °C');
});

test('fan_only hides the setpoint and the fan select still works', async ({ page, mock }) => {
    await openLounge(page);
    const row = device(page, SALON);

    await mode(row, MESSAGES.climate.mode.fan_only).click();
    await expect(row.locator('.climate-io__setpoint')).toHaveCount(0);

    await row.getByRole('combobox', { name: copy(MESSAGES.climate.fanOf, SALON) }).selectOption('high');
    await expect.poll(() => commands(mock, 'clim_salon')).toEqual(['fan_only', '{"fan_mode":"high"}']);
    await expect(row.getByRole('combobox', { name: copy(MESSAGES.climate.fanOf, SALON) })).toHaveValue('high');
});

test('a heat-only thermostat offers two modes and no fan or swing', async ({ page }) => {
    await openLounge(page);
    const row = device(page, 'Thermostat salle de bain');

    await expect(row.locator('.climate-io__mode')).toHaveText([
        MESSAGES.climate.mode.off,
        MESSAGES.climate.mode.heat,
    ]);
    await expect(row.getByRole('combobox')).toHaveCount(0);
    await expect(row.locator('.climate-io__current')).toContainText('19.5 °C');
});

test('a device that knows nothing yet shows an unknown mode, no readings, and still works', async ({
    page,
    mock,
}) => {
    await openLounge(page);
    const row = device(page, 'Pompe à chaleur garage');

    await expect(row.locator('.climate-io__chip--unknown')).toHaveText(MESSAGES.climate.mode.unknown);
    await expect(row.locator('.climate-io__current')).toContainText('—');
    await expect(row.locator('.climate-io__setpoint')).toHaveCount(0);
    await expect(row.locator('.climate-io__mode[aria-pressed="true"]')).toHaveCount(0);

    await mode(row, MESSAGES.climate.mode.heat).click();
    await expect.poll(() => commands(mock, 'clim_garage')).toEqual(['heat']);
    await expect(mode(row, MESSAGES.climate.mode.heat)).toHaveAttribute('aria-pressed', 'true');
    await expect(row.locator('.climate-io__chip--unknown')).toHaveCount(0);
});

test('a range-only device has no setpoint outside auto', async ({ page }) => {
    await openLounge(page);
    const row = device(page, 'Split véranda');

    await expect(row.getByRole('slider')).toHaveCount(2);
    await mode(row, MESSAGES.climate.mode.heat).click();
    await expect(row.locator('.climate-io__setpoint')).toHaveCount(0);
    await expect(row.getByRole('combobox')).toHaveCount(1);
});

test('keeps every control inside the viewport', async ({ page }) => {
    await openLounge(page);
    const viewport = page.viewportSize()!;

    for (const name of [SALON, 'Thermostat bureau', 'Ventilo-convecteur']) {
        const box = (await device(page, name).boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    }
});
