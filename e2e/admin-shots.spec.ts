// Captures of every admin page for the UI review (ARCHI_SHOT=1 keeps them).
// The shell scrolls inside `.app-shell__content`, so a full-page capture would
// miss everything below the fold: each page is shot at the top and, when it
// scrolls, at the bottom.

import { adminScreen, expect, loginAs, test } from './fixtures';

const ADMIN_PASSWORD = 'correct horse battery';

const PAGES = ['updates', 'network', 'services', 'logs', 'time', 'mcp', 'security', 'system', 'settings'];

test('every admin page, captured at the top and the bottom of its scroll', async ({ page, mock }, testInfo) => {
    await mock.reset();
    await mock.admin({ password: ADMIN_PASSWORD });
    await page.goto('/');
    await loginAs(page);
    const admin = adminScreen(page);
    await admin.tab.click();
    await admin.adminPassword.fill(ADMIN_PASSWORD);
    await admin.submit.click();
    await expect(admin.hub).toBeVisible();

    const scroller = page.locator('.app-shell__content');
    const shoot = async (name: string): Promise<void> => {
        await scroller.evaluate((el) => (el.scrollTop = 0));
        await page.screenshot({ path: testInfo.outputPath(`${name}-top.png`) });
        const scrolls = await scroller.evaluate((el) => {
            el.scrollTop = el.scrollHeight;
            return el.scrollTop > 0;
        });
        if (scrolls) await page.screenshot({ path: testInfo.outputPath(`${name}-bottom.png`) });
    };

    await shoot('hub');
    for (const id of PAGES) {
        await admin.tile(id).scrollIntoViewIfNeeded();
        await admin.tile(id).click();
        await expect(page).toHaveURL(new RegExp(`#/admin/${id}$`));
        await expect(page.locator('.sub-page, .page-head__title').first()).toBeVisible();
        await page.waitForTimeout(400);
        await shoot(id);
        await page.goBack();
        await expect(admin.hub).toBeVisible();
    }
});
