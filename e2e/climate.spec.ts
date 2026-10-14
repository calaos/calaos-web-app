// The climate widget against the mock's climate fixtures, from the tap on a
// row to the command on the wire and back.
//
// Each device in mock-server/fixtures/home.json is one status of the table in
// docs/devices/UI_CLIMATE.md:
//   clim_salon      cools (full capabilities: six modes, fan, swing, humidity)
//   thermo_sdb      heats (heat-only thermostat, one setpoint)
//   clim_sejour     auto, 19.5 – 24.5, heating
//   clim_bureau     auto at the min_range stop
//   thermo_couloir  wants to heat, the relay waits (lockout)
//   thermo_bureau   off
//   clim_garage     mode never received, no setpoint capability
//   clim_veranda    offline (connected: false)
//   thermo_cave     held by a safety rule (fault)
//   clim_fancoil    dry, no action reported

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import fr from '../app/src/i18n/fr.json';
import { MESSAGES, expect, loginAs, test } from './fixtures';
import type { MockControl } from './fixtures';
import type { Locator, Page, TestInfo } from '@playwright/test';

/** Room ids are indices into the hits-desc room list (see home-rooms.spec). */
const LOUNGE = 2;

/** Quiet period of the widget's debounce; polls below simply outwait it. */
const DEBOUNCE_MS = 350;

const C = MESSAGES.climate;

const DEVICES = {
    cool: { id: 'clim_salon', name: 'Climatisation salon' },
    heat: { id: 'thermo_sdb', name: 'Thermostat salle de bain' },
    auto: { id: 'clim_sejour', name: 'PAC séjour' },
    stop: { id: 'clim_bureau', name: 'Clim bureau' },
    lockout: { id: 'thermo_couloir', name: 'Radiateur couloir' },
    off: { id: 'thermo_bureau', name: 'Thermostat bureau' },
    unknown: { id: 'clim_garage', name: 'Pompe à chaleur garage' },
    offline: { id: 'clim_veranda', name: 'Clim véranda' },
    fault: { id: 'thermo_cave', name: 'Chauffage cave' },
    dry: { id: 'clim_fancoil', name: 'Ventilo-convecteur' },
} as const;

const RGB = {
    heat: 'rgb(255, 218, 90)',
    cool: 'rgb(56, 176, 211)',
    wait: 'rgb(224, 163, 86)',
    offline: 'rgb(224, 86, 86)',
};

function copy(template: string, name: string): string {
    return template.replace('{name}', name);
}

function row(page: Page, name: string): Locator {
    return page.locator('.io-row').filter({ has: page.locator('.io-row__name', { hasText: name }) });
}

/** The settings, wherever they are drawn: a side panel or a dialog. */
function settings(page: Page): Locator {
    return page.locator('.climate-detail');
}

function modePill(page: Page): Locator {
    return settings(page).locator('.climate-detail__pill');
}

async function openLounge(page: Page): Promise<void> {
    await page.goto('/');
    await loginAs(page);
    await page.locator('.room-tile').nth(LOUNGE).click();
    await expect(page).toHaveURL(new RegExp(`#/home/${LOUNGE}$`));
}

async function openSettings(page: Page, name: string): Promise<void> {
    await row(page, name).click();
    await expect(settings(page)).toBeVisible();
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

test.describe('opening the settings', () => {
    test.skip(({ isMobile }) => isMobile, 'the side panel is a wide-screen layout');

    test('a tap on the row opens a side panel beside the list, and the cross closes it', async ({ page }) => {
        await openLounge(page);
        await openSettings(page, DEVICES.cool.name);

        const panel = page.locator('.climate-panel');
        await expect(panel).toBeVisible();
        await expect(panel.getByRole('heading', { name: DEVICES.cool.name })).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveCount(0);

        // The list made room: no row runs under the panel.
        const list = (await row(page, DEVICES.cool.name).boundingBox())!;
        const side = (await panel.boundingBox())!;
        expect(list.x + list.width).toBeLessThanOrEqual(side.x);

        await panel.getByRole('button', { name: C.close }).click();
        await expect(panel).toHaveCount(0);
        await expect(row(page, DEVICES.cool.name)).toBeFocused();
    });

    test('Escape closes the panel', async ({ page }) => {
        await openLounge(page);
        await openSettings(page, DEVICES.cool.name);
        await page.keyboard.press('Escape');
        await expect(page.locator('.climate-panel')).toHaveCount(0);
    });

    test('the row opens from the keyboard', async ({ page }) => {
        await openLounge(page);
        await row(page, DEVICES.cool.name).focus();
        await page.keyboard.press('Enter');
        await expect(settings(page)).toBeVisible();
    });
});

test.describe('changing the setpoint and the mode', () => {
    test('+ sends one JSON command and the panel shows the answer', async ({ page, mock }) => {
        await openLounge(page);
        await openSettings(page, DEVICES.cool.name);
        const number = settings(page).locator('.climate-detail__num');
        await expect(number).toHaveText('21°');

        const raise = settings(page).getByRole('button', { name: copy(C.raise, DEVICES.cool.name) });
        await raise.click();
        await raise.click();
        await expect(number).toHaveText('22°');

        // Two taps are one gesture to the server.
        await expect.poll(() => commands(mock, DEVICES.cool.id), { timeout: DEBOUNCE_MS * 10 }).toEqual([
            '{"target_temp":22}',
        ]);
        await expect(number).toHaveText('22°');
        // The row behind says it too.
        await expect(row(page, DEVICES.cool.name).locator('.climate-io__set')).toHaveText('22°');
    });

    test('the mode pill opens the list; choosing a mode sends it plain and closes the list', async ({ page, mock }) => {
        await openLounge(page);
        await openSettings(page, DEVICES.cool.name);
        await expect(modePill(page)).toHaveText(C.mode.cool);

        await modePill(page).click();
        const list = page.getByRole('dialog', { name: C.modeTitle });
        await expect(list.getByRole('radio', { name: C.mode.cool })).toHaveAttribute('aria-checked', 'true');
        await list.getByRole('radio', { name: C.mode.heat }).click();

        await expect(list).toHaveCount(0);
        await expect.poll(() => commands(mock, DEVICES.cool.id)).toEqual(['heat']);
        await expect(modePill(page)).toHaveText(C.mode.heat);
        // 23.4 above the 21 target: heating has nothing to do.
        await expect(settings(page).locator('.climate-detail__word')).toHaveText(C.status.idle);
    });

    test('more settings: fan and swing apply on tap, humidity is shown', async ({ page, mock }) => {
        await openLounge(page);
        await openSettings(page, DEVICES.cool.name);

        await settings(page).getByRole('button', { name: C.more }).click();
        const more = page.getByRole('dialog', { name: C.more });
        await expect(more.getByText(copy(C.humidity, '').replace('{value}', '48'))).toBeVisible();

        await more.getByRole('radio', { name: C.option.high }).click();
        await more.getByRole('radio', { name: C.swingOption.vertical }).click();
        // One merged command for both.
        await expect.poll(() => commands(mock, DEVICES.cool.id), { timeout: DEBOUNCE_MS * 10 }).toEqual([
            '{"fan_mode":"high","swing_mode":"vertical"}',
        ]);
        await expect(more.getByRole('radio', { name: C.option.high })).toHaveAttribute('aria-checked', 'true');
    });

    test('auto: the two ends move on their own and keep min_range between them', async ({ page, mock }) => {
        await openLounge(page);
        await openSettings(page, DEVICES.auto.name);
        const numbers = settings(page).locator('.climate-detail__num');
        await expect(numbers).toHaveText(['19.5°', '24.5°']);

        await settings(page).getByRole('button', { name: copy(C.raiseLow, DEVICES.auto.name) }).click();
        await expect.poll(() => commands(mock, DEVICES.auto.id), { timeout: DEBOUNCE_MS * 10 }).toEqual([
            '{"target_temp_low":20,"target_temp_high":24.5}',
        ]);
        await expect(numbers).toHaveText(['20°', '24.5°']);
    });

    test('at the min_range stop the inner buttons are refused and the gap is said', async ({ page, mock }) => {
        await openLounge(page);
        await openSettings(page, DEVICES.stop.name);
        const name = DEVICES.stop.name;

        await expect(settings(page).getByText(copy(C.rangeStop, name).replace('{gap}', '2°'))).toBeVisible();
        await expect(settings(page).getByRole('button', { name: copy(C.raiseLow, name) })).toBeDisabled();
        await expect(settings(page).getByRole('button', { name: copy(C.lowerHigh, name) })).toBeDisabled();
        await expect(settings(page).getByRole('button', { name: copy(C.lowerLow, name) })).toBeEnabled();
        await expect(settings(page).getByRole('button', { name: copy(C.raiseHigh, name) })).toBeEnabled();

        // Pulling the low end away frees the inner buttons again.
        await settings(page).getByRole('button', { name: copy(C.lowerLow, name) }).click();
        await expect(settings(page).getByRole('button', { name: copy(C.raiseLow, name) })).toBeEnabled();
        await expect.poll(() => commands(mock, DEVICES.stop.id), { timeout: DEBOUNCE_MS * 10 }).toEqual([
            '{"target_temp_low":20.5,"target_temp_high":23}',
        ]);
    });
});

test.describe('every status of the table', () => {
    const cases = [
        { key: 'cool', short: C.status.cooling, colour: RGB.cool },
        { key: 'heat', short: C.status.heating, colour: RGB.heat },
        { key: 'auto', short: C.status.heating, colour: RGB.heat },
        { key: 'stop', short: C.statusShort.idle, colour: undefined },
        { key: 'lockout', short: C.statusShort.lockout, colour: RGB.wait },
        { key: 'off', short: C.status.off, colour: undefined },
        { key: 'unknown', short: C.statusShort.unknown, colour: undefined },
        { key: 'offline', short: C.status.offline, colour: RGB.offline },
        { key: 'fault', short: C.fault.sensor_stale, colour: RGB.offline },
    ] as const;

    for (const { key, short, colour } of cases) {
        test(`${key}: the row and the settings say so`, async ({ page }) => {
            await openLounge(page);
            const device = DEVICES[key];
            const status = row(page, device.name).locator('.climate-io__status');
            await expect(status).toHaveText(short);
            if (colour) await expect(status).toHaveCSS('color', colour);

            await openSettings(page, device.name);
            const word = settings(page).locator('.climate-detail__word');
            if (key === 'lockout') await expect(word).toHaveText(/^Starts in 2 min \d\d$/);
            else if (key === 'stop' || key === 'off' || key === 'unknown') await expect(word).toHaveText(key === 'stop' ? C.status.idle : C.status[key === 'off' ? 'off' : 'unknown']);
            else await expect(word).toHaveText(short);
            if (colour) await expect(word).toHaveCSS('color', colour);
        });
    }

    test('offline: nothing can be changed', async ({ page }) => {
        await openLounge(page);
        await openSettings(page, DEVICES.offline.name);
        await expect(settings(page).getByRole('button', { name: copy(C.raise, DEVICES.offline.name) })).toBeDisabled();
        await expect(settings(page).getByRole('button', { name: copy(C.lower, DEVICES.offline.name) })).toBeDisabled();
        await expect(modePill(page)).toBeDisabled();
    });

    test('unknown mode: a grey pill that still opens the list, and nothing selected', async ({ page, mock }) => {
        await openLounge(page);
        await openSettings(page, DEVICES.unknown.name);
        await expect(modePill(page)).toHaveText(C.mode.unknown);
        await expect(settings(page).locator('.climate-detail__line')).toHaveCount(0);

        await modePill(page).click();
        const list = page.getByRole('dialog', { name: C.modeTitle });
        await expect(list.locator('[aria-checked="true"]')).toHaveCount(0);
        await list.getByRole('radio', { name: C.mode.heat }).click();
        await expect.poll(() => commands(mock, DEVICES.unknown.id)).toEqual(['heat']);
    });

    test('a device without fan, swing or humidity has no more settings', async ({ page }) => {
        await openLounge(page);
        await openSettings(page, DEVICES.heat.name);
        await expect(settings(page).getByRole('button', { name: C.more })).toHaveCount(0);
    });
});

test.describe('below 1024 px the settings are a centred dialog', () => {
    test.skip(({ isMobile }) => isMobile, 'the mobile project already runs this layout everywhere');

    test('at 1023 px: a dialog in the middle of the screen, no side panel', async ({ page }) => {
        await page.setViewportSize({ width: 1023, height: 768 });
        await openLounge(page);
        await openSettings(page, DEVICES.cool.name);

        await expect(page.locator('.climate-panel')).toHaveCount(0);
        const dialog = page.getByRole('dialog', { name: DEVICES.cool.name });
        await expect(dialog).toBeVisible();
        const viewport = page.viewportSize()!;
        // The dialog slides in; it is centred once it has settled.
        await expect
            .poll(async () => {
                const b = (await dialog.boundingBox())!;
                return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)];
            })
            .toEqual([viewport.width / 2, viewport.height / 2].map(Math.round));
        const box = (await dialog.boundingBox())!;
        // Wide: 35rem, not the 22rem of a form.
        expect(box.width).toBeGreaterThan(500);

        await dialog.getByRole('button', { name: C.close }).click();
        await expect(dialog).toHaveCount(0);
    });

    test('at 1024 px it is a panel again', async ({ page }) => {
        await page.setViewportSize({ width: 1024, height: 768 });
        await openLounge(page);
        await openSettings(page, DEVICES.cool.name);
        await expect(page.locator('.climate-panel')).toBeVisible();
        // The list shrank into what the panel left.
        const list = (await row(page, DEVICES.cool.name).boundingBox())!;
        const side = (await page.locator('.climate-panel').boundingBox())!;
        expect(list.x + list.width).toBeLessThanOrEqual(side.x);
    });

    test('the dialog drives the device like the panel does', async ({ page, mock }) => {
        await page.setViewportSize({ width: 800, height: 700 });
        await openLounge(page);
        await openSettings(page, DEVICES.cool.name);
        await settings(page).getByRole('button', { name: copy(C.lower, DEVICES.cool.name) }).click();
        await expect.poll(() => commands(mock, DEVICES.cool.id)).toEqual(['{"target_temp":20.5}']);
        await modePill(page).click();
        // The mode list stacks on top of the dialog.
        await page.getByRole('dialog', { name: C.modeTitle }).getByRole('radio', { name: C.mode.off }).click();
        await expect.poll(() => commands(mock, DEVICES.cool.id)).toEqual(['{"target_temp":20.5}', 'off']);
    });
});

test('keeps every row inside the viewport', async ({ page }) => {
    await openLounge(page);
    const viewport = page.viewportSize()!;
    for (const { name } of Object.values(DEVICES)) {
        const box = (await row(page, name).boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    }
});

// Screenshots of every state, for comparing with climate-mockups/round4/final/
// web/*.png. They are attached to the report; SHOTS_DIR also writes them to
// disk, one folder per language (the mockups are in French).
for (const lang of ['fr', 'en'] as const) {
    test.describe(`screenshots of the states (${lang})`, () => {
        test.skip(({ isMobile }) => isMobile, 'compared with the 1280 px mockups');
        test.use({ locale: lang === 'fr' ? 'fr-FR' : 'en-US' });

        const L = lang === 'fr' ? fr.climate : C;

        async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
            // Let the fade-in of the panel and dialogs finish.
            await page.waitForTimeout(400);
            const body = await page.screenshot();
            await testInfo.attach(`${lang}/${name}`, { body, contentType: 'image/png' });
            const dir = process.env.SHOTS_DIR;
            if (dir) {
                mkdirSync(join(dir, lang), { recursive: true });
                writeFileSync(join(dir, lang, `${name}.png`), body);
            }
        }

        test('room list and one panel per state', async ({ page }, testInfo) => {
            await page.setViewportSize({ width: 1280, height: 1700 });
            await openLounge(page);
            await row(page, DEVICES.cool.name).hover();
            await shoot(page, testInfo, 'room-states');

            await page.setViewportSize({ width: 1280, height: 800 });
            for (const key of ['cool', 'heat', 'auto', 'stop', 'lockout', 'off', 'unknown', 'offline', 'fault', 'dry'] as const) {
                await openSettings(page, DEVICES[key].name);
                await page.mouse.move(0, 0);
                await shoot(page, testInfo, `detail-${key}`);
            }

            await openSettings(page, DEVICES.cool.name);
            await modePill(page).click();
            await expect(page.getByRole('dialog', { name: L.modeTitle })).toBeVisible();
            await shoot(page, testInfo, 'popup-mode');
            await page.keyboard.press('Escape');
            await settings(page).getByRole('button', { name: L.more }).click();
            await expect(page.getByRole('dialog', { name: L.more })).toBeVisible();
            await shoot(page, testInfo, 'popup-more');
            await page.keyboard.press('Escape');

            await page.setViewportSize({ width: 1000, height: 768 });
            // The open panel became a dialog on its own.
            await expect(page.getByRole('dialog', { name: DEVICES.cool.name })).toBeVisible();
            await shoot(page, testInfo, 'dialog-below-1024');
        });
    });
}
