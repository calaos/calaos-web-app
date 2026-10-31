// Dedicated captures of the Admin hub and of the pages split out of it, EN and
// FR, on the desktop and phone projects. Each is taken once the fade-in is
// over; the assertions only keep a capture from showing the wrong state.

import en from '../app/src/i18n/en.json';
import fr from '../app/src/i18n/fr.json';
import { MOCK_PHONES, expect, loginAs, test } from './fixtures';
import type { Page, TestInfo } from '@playwright/test';

const ADMIN_PASSWORD = 'correct horse battery';

for (const lang of ['en', 'fr'] as const) {
    const T = (lang === 'fr' ? fr : en).admin;

    test.describe(`hub captures (${lang})`, () => {
        test.use({ locale: lang === 'fr' ? 'fr-FR' : 'en-US' });

        test.beforeEach(async ({ mock }) => {
            await mock.reset();
            await mock.admin({ password: ADMIN_PASSWORD, approvers: [MOCK_PHONES.pixel.tokenId] });
        });

        async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
            await page.waitForTimeout(400);
            await page.screenshot({ path: testInfo.outputPath(`shot-${lang}-${name}.png`), fullPage: true });
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
            await expect(page.locator('[data-page="updates"]')).toBeVisible();
        }

        async function open(page: Page, id: string): Promise<void> {
            await page.locator(`[data-page="${id}"]`).click();
            await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        }

        test('hub', async ({ page }, testInfo) => {
            await unlock(page);
            await shoot(page, testInfo, 'tiles');
        });

        test('hub with updates waiting', async ({ page }, testInfo) => {
            await unlock(page);
            await open(page, 'updates');
            await page.getByRole('button', { name: T.updates.check, exact: true }).click();
            await expect(page.locator('.updates__name')).toHaveCount(2);
            await shoot(page, testInfo, 'updates');
            await page.goBack();
            await expect(page.locator('[data-page="updates"]')).toHaveClass(/pages__tile--warn/);
            await shoot(page, testInfo, 'tiles-updates-waiting');
        });

        test('mcp', async ({ page }, testInfo) => {
            await unlock(page);
            await open(page, 'mcp');
            await expect(page.locator('.mcp [data-field="token"]')).toBeVisible();
            await shoot(page, testInfo, 'mcp');
        });

        test('security', async ({ page }, testInfo) => {
            await unlock(page);
            await open(page, 'security');
            await expect(page.locator('.approvers__row')).toHaveCount(1);
            await shoot(page, testInfo, 'security');
        });

        test('system', async ({ page }, testInfo) => {
            await unlock(page);
            await open(page, 'system');
            await expect(page.locator('.system')).toBeVisible();
            await shoot(page, testInfo, 'system');
        });
    });
}
