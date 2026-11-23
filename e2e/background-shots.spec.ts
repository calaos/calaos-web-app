// Captures of the backdrop at desktop and phone sizes, and across a live resize
// (ARCHI_SHOT=1 keeps them).

import { expect, loginAs, test } from './fixtures';

const SIZES = [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'desktop-small', width: 900, height: 600 },
    { name: 'portrait', width: 390, height: 844 },
];

test('backdrop at desktop and portrait sizes', async ({ page, mock }, testInfo) => {
    await mock.reset();
    await page.setViewportSize({ width: SIZES[0].width, height: SIZES[0].height });
    await page.goto('/');
    await loginAs(page);
    for (const s of SIZES) {
        await page.setViewportSize({ width: s.width, height: s.height });
        await page.waitForTimeout(800);
        await page.screenshot({ path: testInfo.outputPath(`bg-${s.name}.png`) });
    }
});

test('the backdrop follows a resize and switches to the portrait variant', async ({ page, mock }) => {
    await mock.reset();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await loginAs(page);
    const bg = page.locator('#calaos-bg');
    await expect(bg).toHaveCSS('background-image', /calaos-bg\/desktop\/base\.png/);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(bg).toHaveCSS('background-image', /calaos-bg\/phone\/base\.png/);
});
