// The Events page, opened from Réglages: the log newest first, 50 per page,
// a detail per event and its picture (a POST with the household credentials,
// read once, in the detail only).

import type { Page, TestInfo } from '@playwright/test';
import { MESSAGES, adminScreen, expect, loginAs, test } from './fixtures';

const ADMIN_PASSWORD = 'correct horse battery';
const E = MESSAGES.events;

test.beforeEach(async ({ mock }) => {
    await mock.reset();
    await mock.admin({ password: ADMIN_PASSWORD, noiseEvents: 60, eventSamples: true });
});

async function openEvents(page: Page): Promise<void> {
    await page.goto('/');
    await loginAs(page);
    const admin = adminScreen(page);
    await admin.tab.click();
    await admin.adminPassword.fill(ADMIN_PASSWORD);
    await admin.submit.click();
    await expect(admin.hub).toBeVisible();
    await admin.tile('events').click();
    await expect(page).toHaveURL(/#\/admin\/events$/);
    await expect(items(page).first()).toBeVisible();
}

const items = (page: Page) => page.getByTestId('event-item');

async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
    await page.waitForTimeout(400);
    await page.screenshot({ path: testInfo.outputPath(`events-${name}.png`), fullPage: true });
}

test('lists the log newest first and loads the next page', async ({ page }, testInfo) => {
    await openEvents(page);
    await expect(items(page)).toHaveCount(50);
    await expect(items(page).first()).toContainText(E.type.unknown);
    await expect(items(page).nth(1)).toContainText(E.type.push);
    await shoot(page, testInfo, 'list');

    await page.getByTestId('event-more').click();
    await expect(items(page)).toHaveCount(64);
    await expect(page.getByTestId('event-more')).toHaveCount(0);
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
