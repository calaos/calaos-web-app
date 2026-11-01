// Captures of every admin page, and of the states that only appear after an action,
// for the UI review (ARCHI_SHOT=1 keeps them).
// The shell scrolls inside `.app-shell__content`, so a full-page capture would
// miss everything below the fold: each page is shot at the top and, when it
// scrolls, at the bottom.

import type { Page } from '@playwright/test';
import { MESSAGES, MOCK_PHONES, adminScreen, expect, loginAs, settled, test } from './fixtures';
import type { ControlOp } from './fixtures';
import net from '../app/src/i18n/admin/network.en.json';

const ADMIN_PASSWORD = 'correct horse battery';

async function unlock(page: Page): Promise<void> {
    const admin = adminScreen(page);
    await admin.tab.click();
    await admin.adminPassword.fill(ADMIN_PASSWORD);
    await admin.submit.click();
    await expect(admin.hub).toBeVisible();
}

const PAGES = ['updates', 'network', 'services', 'logs', 'time', 'mcp', 'security', 'system', 'settings'];

test('every admin page, captured at the top and the bottom of its scroll', async ({ page, mock }, testInfo) => {
    await mock.reset();
    await mock.admin({ password: ADMIN_PASSWORD });
    await page.goto('/');
    await loginAs(page);
    const admin = adminScreen(page);
    await unlock(page);

    const scroller = page.locator('.app-shell__content');
    const shoot = async (name: string): Promise<void> => {
        await settled(page);
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
        await shoot(id);
        await page.goBack();
        await expect(admin.hub).toBeVisible();
    }
});

test('states that only follow an action: network edit form, refusal, fresh MCP token', async ({ page, mock }, testInfo) => {
    await mock.reset();
    await mock.admin({ password: ADMIN_PASSWORD, codeIntervalMs: 1_000, approvers: [MOCK_PHONES.pixel.tokenId] });
    await page.goto('/');
    await loginAs(page);
    await unlock(page);
    const admin = adminScreen(page);
    const scroller = page.locator('.app-shell__content');
    const shoot = async (name: string): Promise<void> => {
        await settled(page);
        await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
    };

    await admin.tile('network').click();
    const eth0 = page.locator('.network__intf').filter({ has: page.getByRole('heading', { name: 'eth0', exact: true }) });
    await expect(eth0).toContainText(/\d+\.\d+\.\d+\.\d+\/\d+/);
    await eth0.getByRole('button', { name: `${net.edit} eth0` }).click();
    await expect(page.getByLabel(net.form.address)).toBeVisible();
    await eth0.scrollIntoViewIfNeeded();
    await shoot('network-edit');

    await page.getByLabel(net.form.address).fill('192.168.1.20/24');
    await page.getByRole('button', { name: net.form.apply }).click();
    const warning = page.getByRole('dialog', { name: net.warn.title });
    await warning.getByRole('button', { name: net.warn.confirm }).click();
    const code = page.getByRole('dialog').getByLabel(MESSAGES.admin.code.label);
    await expect(code).toBeVisible();
    // Applied from elsewhere while this page was typing: the box refuses.
    await mock.send({ op: 'admin', network: { pending: { intf: 'eth1', ageMs: 30_000 } } } as ControlOp);
    const pushed = await mock.lastCode();
    await code.fill(pushed.code);
    await expect(page.locator('.network__refusal')).toBeVisible();
    await scroller.evaluate((el) => (el.scrollTop = 0));
    await shoot('network-refusal');

    await page.goto('/#/admin/mcp');
    await expect(page.locator('.mcp')).toBeVisible();
    await page.getByRole('button', { name: MESSAGES.admin.actions.regenerate }).click();
    await page.getByRole('dialog').getByRole('button', { name: MESSAGES.admin.actions.mcpConfirm }).click();
    await expect(page.locator('.mcp__row--fresh')).toBeVisible();
    await shoot('mcp-fresh');
});
