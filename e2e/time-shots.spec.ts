// Dedicated captures of the Date and time states, EN and FR, on the desktop
// and phone projects. Each is taken once the fade-in is over; the assertions
// only keep a capture from showing the wrong state.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import en from '../app/src/i18n/admin/time.en.json';
import fr from '../app/src/i18n/admin/time.fr.json';
import { expect, loginAs, test } from './fixtures';
import type { ControlOp } from './fixtures';
import type { Page, TestInfo } from '@playwright/test';

const ADMIN_PASSWORD = 'correct horse battery';

for (const lang of ['en', 'fr'] as const) {
    const T = lang === 'fr' ? fr : en;

    test.describe(`time page captures (${lang})`, () => {
        test.use({ locale: lang === 'fr' ? 'fr-FR' : 'en-US', timezoneId: 'America/Los_Angeles' });

        test.beforeEach(async ({ mock }) => {
            await mock.reset();
            await mock.admin({ password: ADMIN_PASSWORD });
        });

        const card = (page: Page) => page.locator('section.time');
        const manualInput = (page: Page) => card(page).getByLabel(T.manualTitle, { exact: true });
        const button = (page: Page, name: string) => card(page).getByRole('button', { name, exact: true });

        async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
            await page.waitForTimeout(400);
            const body = await page.screenshot();
            const file = `${lang}/time-${name}-${testInfo.project.name}`;
            await testInfo.attach(file, { body, contentType: 'image/png' });
            const dir = process.env.SHOTS_DIR;
            if (dir) {
                mkdirSync(join(dir, lang), { recursive: true });
                writeFileSync(join(dir, `${file}.png`), body);
            }
        }

        // The tab label is in the page language, so go by the route.
        async function unlock(page: Page): Promise<void> {
            await page.goto('/');
            await loginAs(page);
            await page.evaluate(() => {
                location.hash = '#/admin';
            });
            await page.locator('.admin-password input[type="password"]').first().fill(ADMIN_PASSWORD);
            await page.locator('.admin-password__submit').click();
            await expect(page.locator('[data-page="time"]')).toBeVisible();
        }

        async function openTime(page: Page): Promise<void> {
            await unlock(page);
            await page.locator('[data-page="time"]').click();
            await expect(card(page).locator('.time__clock')).toBeVisible();
        }

        test('hub tile', async ({ page }, testInfo) => {
            await unlock(page);
            await page.locator('[data-page="time"]').scrollIntoViewIfNeeded();
            await shoot(page, testInfo, 'hub-tile');
        });

        test('loading', async ({ page }, testInfo) => {
            // Hold the time_get request so the page stays on its loading line.
            await page.routeWebSocket(/\/api/, (ws) => {
                const server = ws.connectToServer();
                ws.onMessage((message) => {
                    if (typeof message === 'string' && message.includes('time_get')) return;
                    server.send(message);
                });
            });
            await unlock(page);
            await page.locator('[data-page="time"]').click();
            await expect(card(page).locator('.time__loading')).toBeVisible();
            await shoot(page, testInfo, 'loading');
        });

        test('daemon too old', async ({ page, mock }, testInfo) => {
            await mock.admin({ tooOld: ['time_get', 'time_zones'] });
            await unlock(page);
            await page.locator('[data-page="time"]').click();
            await expect(card(page).locator('.time__error')).toBeVisible();
            await shoot(page, testInfo, 'daemon-too-old');
        });

        test('device dialog, over an hour', async ({ page, mock }, testInfo) => {
            await mock.send({ op: 'admin', time: { offsetMs: -3 * 3_600_000, ntp: false, synchronized: false } } as ControlOp);
            await openTime(page);
            await button(page, T.setFromDevice).click();
            await expect(page.getByRole('dialog')).toBeVisible();
            await shoot(page, testInfo, 'dialog-device');
        });

        test('NTP dialog, clock hours off', async ({ page, mock }, testInfo) => {
            await mock.send({ op: 'admin', time: { offsetMs: 5 * 3_600_000, ntp: false, synchronized: false } } as ControlOp);
            await openTime(page);
            await button(page, T.useNtp).click();
            await expect(page.getByRole('dialog')).toBeVisible();
            await shoot(page, testInfo, 'dialog-ntp');
        });

        test('manual dialog, NTP cut', async ({ page }, testInfo) => {
            await openTime(page);
            await manualInput(page).fill('2026-07-01T12:00');
            await button(page, T.manualSet).click();
            await expect(page.getByRole('dialog')).toBeVisible();
            await shoot(page, testInfo, 'dialog-manual');
        });

        // "invalid" is not reachable by hand: "Set" stays disabled on an empty field.
        test('manual input errors', async ({ page, mock }, testInfo) => {
            await mock.send({ op: 'admin', time: { ntp: false, synchronized: false } } as ControlOp);
            await openTime(page);
            await manualInput(page).fill('2027-03-28T02:30');
            await button(page, T.manualSet).click();
            await expect(card(page).locator('.time__problem')).toBeVisible();
            await shoot(page, testInfo, 'error-nonexistent');
            await manualInput(page).fill('2019-06-01T10:00');
            await button(page, T.manualSet).click();
            await expect(card(page).locator('.time__problem')).toBeVisible();
            await shoot(page, testInfo, 'error-range');
        });

        test('zone filter without a match', async ({ page }, testInfo) => {
            await openTime(page);
            await card(page).getByLabel(T.zoneFilter).fill('zzz');
            await expect(card(page).locator('.time__none')).toBeVisible();
            await shoot(page, testInfo, 'zone-no-match');
        });
    });
}
