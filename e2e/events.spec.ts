// The Events page, a user page opened from the top bar (no admin password): the log newest first, 50 per page,
// a detail per event and its picture (a POST with the household credentials,
// read once, in the detail only).

import type { Page, TestInfo } from '@playwright/test';
import { MESSAGES, expect, loginAs, test } from './fixtures';

const ADMIN_PASSWORD = 'correct horse battery';
const E = MESSAGES.events;

test.beforeEach(async ({ mock }) => {
    await mock.reset();
    await mock.admin({ password: ADMIN_PASSWORD, noiseEvents: 60, eventSamples: true });
});

async function openEvents(page: Page): Promise<void> {
    await page.goto('/');
    await loginAs(page);
    await page.getByTestId('events-entry').click();
    await expect(page).toHaveURL(/#\/events$/);
    await expect(items(page).first()).toBeVisible();
}

const items = (page: Page) => page.getByTestId('event-item');

async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
    // Captures are for review runs only (EVENTS_SHOTS=1); a plain run does not pay for them.
    if (process.env.EVENTS_SHOTS !== '1') return;
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: testInfo.outputPath(`events-${name}.png`), fullPage: true });
}

test('lists the log newest first and loads the next page', async ({ page }, testInfo) => {
    await openEvents(page);
    await expect(items(page)).toHaveCount(50);
    await expect(items(page).first()).toContainText(E.type.unknown);
    await expect(items(page).nth(1)).toContainText('Hall light left on');
    await shoot(page, testInfo, 'list');

    await page.getByTestId('event-more').click();
    await expect(items(page)).toHaveCount(65);
    await expect(page.getByTestId('event-more')).toHaveCount(0);
});

test('shows the appliance icon, room and action, and a photo indicator, as the mobile does', async ({ page }, testInfo) => {
    await openEvents(page);
    const light = items(page).filter({ hasText: 'Plafonnier' }).first();
    await expect(light).toContainText(new RegExp(`Salon · (${E.action.on}|${E.action.off})`));
    await expect(light.getByTestId('event-icon')).toBeVisible();
    await expect(items(page).filter({ hasText: 'Motion at the front door' }).getByTestId('event-has-picture')).toBeVisible();
    await expect(items(page).filter({ hasText: 'Motion at the front door' }).getByTestId('event-icon-push')).toBeVisible();
    await expect(light.getByTestId('event-has-picture')).toHaveCount(0);
    // A push that names an IO resolves it like any other event.
    const pushWithIo = items(page).filter({ hasText: 'Hall light left on' });
    await expect(pushWithIo).toContainText('Plafonnier');
    await expect(pushWithIo).toContainText('Salon');
    await expect(pushWithIo.getByTestId('event-icon')).toBeVisible();
    await expect(items(page).first().getByTestId('event-icon-unknown')).toBeVisible();
    await shoot(page, testInfo, 'parity');
});

test('needs no admin password and Back returns to the home', async ({ page }) => {
    await openEvents(page);
    await expect(page.getByTestId('events-entry')).toHaveCount(0);
    await page.getByRole('button', { name: MESSAGES.chrome.back }).click();
    await expect(page).toHaveURL(/#\/home$/);
    await expect(page.getByTestId('events-entry')).toBeVisible();
});

test('opens an event and shows its picture, requested once', async ({ page, mock }, testInfo) => {
    await openEvents(page);
    expect((await mock.adminStatus()).eventPictureReads).toBe(0);

    await items(page).filter({ hasText: 'Motion at the front door' }).click();
    const detail = page.getByTestId('event-detail');
    await expect(detail).toContainText('Motion at the front door');
    const picture = page.getByTestId('event-picture');
    await expect(picture).toBeVisible();
    await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    expect((await mock.adminStatus()).eventPictureReads).toBe(1);
    await shoot(page, testInfo, 'detail-picture');

    await page.getByTestId('event-back').click();
    await expect(detail).toHaveCount(0);
    expect((await mock.adminStatus()).eventPictureReads).toBe(1);
});

test('shows a placeholder when the picture is gone, without retrying', async ({ page, mock }, testInfo) => {
    await openEvents(page);
    await items(page).filter({ hasText: 'Doorbell' }).click();
    await expect(page.getByTestId('event-picture-missing')).toBeVisible();
    await expect(page.getByTestId('event-picture')).toHaveCount(0);
    expect((await mock.adminStatus()).eventPictureReads).toBe(1);
    await shoot(page, testInfo, 'detail-missing');
});

test('refreshing reads the first page again', async ({ page, mock }) => {
    await openEvents(page);
    const before = (await mock.adminStatus()).eventlogReads;
    await page.getByTestId('event-refresh').click();
    await expect.poll(async () => (await mock.adminStatus()).eventlogReads).toBeGreaterThan(before);
    await expect(items(page)).toHaveCount(50);
});
