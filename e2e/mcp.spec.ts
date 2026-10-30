// The MCP access card of the Admin hub against the mock: the address and the
// token from `get_mcp_info` (HTTP, session in the body), masked until shown,
// copied, and replaced by the new one after `mcp_regenerate`.

import type { Page } from '@playwright/test';
import { MESSAGES, adminScreen, expect, loginAs, test } from './fixtures';

const ADMIN_PASSWORD = 'correct horse battery';
const M = MESSAGES.admin.mcp;

test.beforeEach(async ({ mock }) => {
    await mock.reset();
    await mock.admin({ password: ADMIN_PASSWORD });
});

async function openUnlocked(page: Page): Promise<void> {
    await page.goto('/');
    await loginAs(page);
    const admin = adminScreen(page);
    await admin.tab.click();
    await admin.adminPassword.fill(ADMIN_PASSWORD);
    await admin.submit.click();
    await expect(admin.updates).toBeVisible();
}

const card = (page: Page) => page.locator('.mcp');
const tokenRow = (page: Page) => card(page).locator('[data-field="token"]');

test('shows the address and a masked token, read with the session in the body', async ({ page, mock }) => {
    const request = page.waitForRequest((req) => req.method() === 'POST' && req.postData()?.includes('get_mcp_info') === true);
    await openUnlocked(page);
    const sent = await request;
    expect(new URL(sent.url()).search).toBe('');
    expect(JSON.parse(sent.postData() ?? '{}')).toMatchObject({ action: 'get_mcp_info', admin_session: expect.any(String) });

    const { mcpToken } = await mock.adminStatus();
    const origin = new URL(page.url()).origin;
    await expect(card(page).locator('[data-field="url"] code')).toHaveText(`${origin}/mcp`);
    await expect(tokenRow(page).getByRole('img', { name: M.hidden })).toBeVisible();
    await expect(card(page)).not.toContainText(mcpToken);

    await tokenRow(page).getByRole('button', { name: M.show }).click();
    await expect(tokenRow(page).locator('code')).toHaveText(mcpToken);
    await tokenRow(page).getByRole('button', { name: M.hide }).click();
    await expect(card(page)).not.toContainText(mcpToken);
});

test('copies the token and the address', async ({ page, mock, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openUnlocked(page);
    const { mcpToken } = await mock.adminStatus();

    await tokenRow(page).getByRole('button', { name: M.copy }).click();
    await expect(tokenRow(page).getByRole('button', { name: M.copied })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(mcpToken);
    // Copying does not reveal it.
    await expect(card(page)).not.toContainText(mcpToken);

    await card(page).locator('[data-field="url"]').getByRole('button', { name: M.copy }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/mcp$/);
});

test('after a regeneration the card shows the new token, marked as new', async ({ page, mock }) => {
    await openUnlocked(page);
    const before = (await mock.adminStatus()).mcpToken;
    await tokenRow(page).getByRole('button', { name: M.show }).click();
    await expect(tokenRow(page).locator('code')).toHaveText(before);

    await page.getByRole('button', { name: MESSAGES.admin.actions.regenerate }).click();
    await page.getByRole('dialog').getByRole('button', { name: MESSAGES.admin.actions.mcpConfirm }).click();
    await expect(adminScreen(page).info).toContainText(MESSAGES.admin.info.mcp_regenerated);

    await expect(tokenRow(page)).toHaveClass(/mcp__row--fresh/);
    await expect(tokenRow(page)).toContainText(M.renewed);
    const after = (await mock.adminStatus()).mcpToken;
    expect(after).not.toBe(before);
    // Masked again: a new secret is not shown without being asked for.
    await expect(card(page)).not.toContainText(after);
    await tokenRow(page).getByRole('button', { name: M.show }).click();
    await expect(tokenRow(page).locator('code')).toHaveText(after);
});
