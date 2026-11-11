// The Versions page, a household page opened from the top bar (no admin password):
// client, server, container and OS versions, a Copy button, and a state for an
// unreachable calaos-container.

import type { Page, TestInfo } from '@playwright/test';
import en from '../app/src/i18n/en.json';
import fr from '../app/src/i18n/fr.json';
import { expect, loginAs, test } from './fixtures';

for (const lang of ['en', 'fr'] as const) {
    const T = (lang === 'fr' ? fr : en).versions;

    test.describe(`versions page (${lang})`, () => {
        test.use({ locale: lang === 'fr' ? 'fr-FR' : 'en-US' });

        test.beforeEach(async ({ mock }) => {
            await mock.reset();
        });

        async function open(page: Page): Promise<void> {
            await page.goto('/');
            await loginAs(page);
            await page.getByTestId('versions-entry').click();
            await expect(page).toHaveURL(/#\/versions$/);
            await expect(page.getByTestId('versions-copy')).toBeVisible();
        }

        async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
            // After the fade-in; every png of the test's folder goes to the UI review.
            await page.waitForTimeout(400);
            await page.screenshot({ path: testInfo.outputPath(`shot-${lang}-${name}.png`), fullPage: true });
        }

        test('lists the client, the server, the box and its packages', async ({ page }, testInfo) => {
            await open(page);
            await expect(page.getByRole('heading', { name: T.title })).toBeVisible();
            await expect(page.getByTestId('versions-server')).toHaveText('4.8.0');
            await expect(page.getByTestId('versions-container')).toHaveText('1.9.1');
            await expect(page.getByTestId('versions-os')).toHaveText('4.8.0');
            await expect(page.getByTestId('versions-kernel')).toHaveText('6.12.48-rt');
            await expect(page.getByTestId('versions-package')).toHaveCount(4);
            await expect(page.getByTestId('versions-client-value')).not.toBeEmpty();
            await expect(page.getByTestId('versions-unreachable')).toHaveCount(0);
            await shoot(page, testInfo, 'ok');
        });

        test('copies the contract text', async ({ page, context }, testInfo) => {
            await context.grantPermissions(['clipboard-read', 'clipboard-write']);
            await open(page);
            await page.getByTestId('versions-copy').click();
            await expect(page.getByTestId('versions-copy-state')).toHaveText(T.copied);
            const text = await page.evaluate(() => navigator.clipboard.readText());
            expect(text).toMatch(/^Calaos versions \(\d{4}-\d{2}-\d{2}\)\nclient: calaos-web-app \S+\ncalaos-server 4\.8\.0\n/);
            expect(text).toContain('calaos-container 1.9.1\ncalaos-os 4.8.0 · debian 13.1 · kernel 6.12.48-rt\n');
            expect(text).toContain('calaos-home 4.5.0');
            await shoot(page, testInfo, 'copied');
        });

        test('says the container is unreachable and keeps the server and the client', async ({ page, mock }, testInfo) => {
            await mock.admin({ containerDown: true });
            await open(page);
            await expect(page.getByTestId('versions-unreachable')).toContainText(T.unreachable);
            await expect(page.getByTestId('versions-server')).toHaveText('4.8.0');
            await expect(page.getByTestId('versions-client-value')).not.toBeEmpty();
            await expect(page.getByTestId('versions-package')).toHaveCount(0);
            await shoot(page, testInfo, 'container-down');
        });
    });
}
