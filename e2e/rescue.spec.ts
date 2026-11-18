// The rescue banner and its information dialog: shown to anyone signed in to
// the house while the box runs on a snapshot, with no admin action without an
// admin session.

import snapshots from '../app/src/i18n/admin/snapshots.en.json';
import { MESSAGES, adminScreen, expect, loginAs, test } from './fixtures';
import type { ControlOp } from './fixtures';

const ADMIN_PASSWORD = 'correct horse battery';
const rescue = MESSAGES.rescue;

test.beforeEach(async ({ mock }) => {
    await mock.reset();
    await mock.admin({ password: ADMIN_PASSWORD });
});

const banner = (page: import('@playwright/test').Page) => page.locator('[data-rescue-banner]');

test('no banner while the box runs normally', async ({ page }) => {
    await page.goto('/');
    await loginAs(page);
    await expect(page.getByRole('navigation').first()).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
});

test('without an admin session: banner, one-time dialog, no action', async ({ page, mock }) => {
    await mock.send({ op: 'admin', snapshots: { rescue: 142 } } as unknown as ControlOp);
    await page.goto('/');
    await loginAs(page);

    const dialog = page.getByRole('dialog', { name: rescue.info.title });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: rescue.info.close }).click();
    await expect(dialog).toHaveCount(0);

    await expect(banner(page)).toContainText('#142');
    await expect(banner(page)).toHaveAttribute('role', 'status');
    await expect(page.getByRole('button', { name: /roll ?back/i })).toHaveCount(0);

    // Stays on every page, and the dialog does not come back by itself.
    await adminScreen(page).tab.click();
    await expect(banner(page)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await banner(page).getByRole('button', { name: rescue.details }).click();
    await expect(page.getByRole('dialog', { name: rescue.info.title })).toBeVisible();
});

test('"Open Snapshots" without a session leads to the admin password gate', async ({ page, mock }) => {
    await mock.send({ op: 'admin', snapshots: { rescue: 142 } } as unknown as ControlOp);
    await page.goto('/');
    await loginAs(page);
    await page.getByRole('dialog').getByRole('button', { name: rescue.info.open }).click();
    await expect(adminScreen(page).heading).toHaveText(MESSAGES.admin.unlock.title);
    await expect(banner(page)).toBeVisible();
    await adminScreen(page).adminPassword.fill(ADMIN_PASSWORD);
    await adminScreen(page).submit.click();
    await expect(page).toHaveURL(/#\/admin\/snapshots$/);
    await expect(page.getByRole('button', { name: snapshots.rescue.rollback })).toBeVisible();
    // The page is the details: no link to itself.
    await expect(banner(page).getByRole('button')).toHaveCount(0);
});
