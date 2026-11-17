// The snapshots page of the Admin tab against the mock's fake daemon: the list
// as a table or as cards, booting a snapshot behind a question, the rescue
// actions with their confirmation, and the states that are not a list.

import type { Page } from '@playwright/test';
import snapshots from '../app/src/i18n/admin/snapshots.en.json';
import { MESSAGES, adminScreen, expect, loginAs, test } from './fixtures';
import type { ControlOp, MockControl } from './fixtures';

const ADMIN_PASSWORD = 'correct horse battery';

/** `/control {op:'admin', snapshots}` (mock-server/admin-snapshots.mjs `configure`). */
interface SnapshotsPatch {
    rescue?: number | false;
    empty?: boolean;
    fail?: Record<string, string>;
    failOnce?: Record<string, string>;
    unknownOutcome?: boolean | 'unapplied' | null;
    delayMs?: number;
    rebootMs?: number;
}

async function configure(mock: MockControl, patch: SnapshotsPatch): Promise<void> {
    await mock.send({ op: 'admin', snapshots: patch } as unknown as ControlOp);
}

test.beforeEach(async ({ mock }) => {
    await mock.reset();
    await mock.admin({ password: ADMIN_PASSWORD });
});

async function openUnlocked(page: Page, inRescue = false): Promise<void> {
    await page.goto('/');
    await loginAs(page);
    if (inRescue) {
        // The first sign-in during rescue mode opens the information dialog.
        await page.getByRole('dialog').getByRole('button', { name: MESSAGES.rescue.info.close }).click();
    }
    const admin = adminScreen(page);
    await admin.tab.click();
    await expect(admin.heading).toHaveText(MESSAGES.admin.unlock.title);
    await admin.adminPassword.fill(ADMIN_PASSWORD);
    await admin.submit.click();
    await page.locator('[data-page="snapshots"]').click();
    await expect(page).toHaveURL(/#\/admin\/snapshots$/);
}

const snapshotRow = (page: Page, id: number) => page.locator(`table [data-snapshot="${id}"]`);

test('lists the snapshots as a table on a wide screen', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await openUnlocked(page);
    await expect(page.locator('table tbody tr')).toHaveCount(6);
    await expect(snapshotRow(page, 1)).toContainText(snapshots.badge.current);
    await expect(snapshotRow(page, 1)).toContainText(snapshots.badge.default);
    await expect(snapshotRow(page, 143)).toContainText(snapshots.noDate);
    await expect(snapshotRow(page, 143)).toContainText(snapshots.noDescription);
    await expect(snapshotRow(page, 139)).toContainText(snapshots.badge.notBootable);
    await expect(snapshotRow(page, 139).getByRole('button')).toHaveCount(0);
    await expect(snapshotRow(page, 1).getByRole('button')).toHaveCount(0);
    await expect(page.locator('.snaps__cards')).toBeHidden();
});

test('lists the snapshots as cards on a narrow screen, and only those', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    await openUnlocked(page);
    await expect(page.getByRole('listitem').filter({ hasText: '#145' })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
});

test('booting a snapshot asks first, then waits for the box', async ({ page, mock }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await configure(mock, { rebootMs: 1500 });
    await openUnlocked(page);
    await snapshotRow(page, 142).getByRole('button', { name: /#142/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('#142');
    await dialog.getByRole('button', { name: snapshots.bootDialog.confirm, exact: true }).click();
    await expect(page.getByRole('heading', { name: snapshots.state.rebooting.title })).toBeVisible();
    expect(await mock.adminActions()).toContain('snapshot_boot');
});

test('a snapshot the box cannot boot is refused inline, with the list reloaded', async ({ page, mock }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await configure(mock, { failOnce: { snapshot_boot: 'not_bootable' } });
    await openUnlocked(page);
    await snapshotRow(page, 142).getByRole('button', { name: /#142/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: snapshots.bootDialog.confirm, exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(snapshots.state.refused.title);
    await expect(snapshotRow(page, 142)).toBeVisible();
});

test('an unknown outcome is shown as waiting, not as a failure', async ({ page, mock }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await configure(mock, { unknownOutcome: true });
    await openUnlocked(page);
    await snapshotRow(page, 142).getByRole('button', { name: /#142/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: snapshots.bootDialog.confirm, exact: true }).click();
    await expect(page.getByText(snapshots.state.unknown.title)).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
});

test('in rescue, the rollback needs its box ticked every time', async ({ page, mock }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await configure(mock, { rescue: 142 });
    await openUnlocked(page, true);
    await expect(page.getByRole('heading', { name: snapshots.rescue.title })).toBeVisible();

    await page.getByRole('button', { name: snapshots.rescue.rollback }).click();
    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', { name: snapshots.rollbackDialog.confirm, exact: true });
    await expect(dialog.getByRole('button', { name: MESSAGES.dialog.cancel })).toBeFocused();
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('checkbox').check();
    await expect(confirm).toBeEnabled();
    await dialog.getByRole('button', { name: MESSAGES.dialog.cancel }).click();

    await page.getByRole('button', { name: snapshots.rescue.rollback }).click();
    await expect(page.getByRole('dialog').getByRole('checkbox')).not.toBeChecked();
    await page.getByRole('dialog').getByRole('checkbox').check();
    await page.getByRole('dialog').getByRole('button', { name: snapshots.rollbackDialog.confirm, exact: true }).click();
    await expect(page.getByRole('heading', { name: snapshots.state.rebooting.title })).toBeVisible();
    expect(await mock.adminActions()).toContain('snapshot_rollback');
});

test('no snapshot at all says so', async ({ page, mock }) => {
    await configure(mock, { empty: true });
    await openUnlocked(page);
    await expect(page.getByText(snapshots.empty.title)).toBeVisible();
});

test('an unreachable admin service offers a retry that works once it is back', async ({ page, mock }) => {
    await configure(mock, { failOnce: { snapshots_list: 'admin_unavailable' } });
    await openUnlocked(page);
    await expect(page.getByRole('alert')).toContainText(snapshots.state.unreachable.title);
    await page.getByRole('button', { name: snapshots.retry }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText('#145').first()).toBeAttached();
});
