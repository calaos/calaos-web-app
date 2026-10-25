// The services panel of the Admin tab against the mock's fake daemon: a
// restart followed until `since` moves, calaos-server taking the page's own
// connection with it, a unit that fails to start, a unit gone missing, and
// the 409 of an upgrade this client did not see start.

import type { Page } from '@playwright/test';
import services from '../app/src/i18n/admin/services.en.json';
import { MESSAGES, adminScreen, expect, loginAs, test } from './fixtures';
import type { ControlOp, MockControl } from './fixtures';

const ADMIN_PASSWORD = 'correct horse battery';

/** `/control {op:'admin', services}` (mock-server/admin-services.mjs `configure`). */
interface ServicesPatch {
    restartMs?: number;
    fail?: string;
    state?: Record<string, string>;
    dropOnSelfRestart?: boolean;
    upgradeInProgress?: boolean;
}

async function configure(mock: MockControl, patch: ServicesPatch): Promise<void> {
    await mock.send({ op: 'admin', services: patch } as unknown as ControlOp);
}

async function restarts(mock: MockControl): Promise<string[]> {
    const status = await mock.send<{ services: { restarts: string[] } }>({ op: 'admin_status' });
    return status.services.restarts;
}

test.beforeEach(async ({ mock }) => {
    await mock.reset();
    await mock.admin({ password: ADMIN_PASSWORD });
});

async function openUnlocked(page: Page): Promise<void> {
    await page.goto('/');
    await loginAs(page);
    const admin = adminScreen(page);
    await admin.tab.click();
    await expect(admin.heading).toHaveText(MESSAGES.admin.unlock.title);
    await admin.adminPassword.fill(ADMIN_PASSWORD);
    await admin.submit.click();
    await expect(page.locator('.services')).toBeVisible();
}

function row(page: Page, id: string) {
    return page.locator(`.services [data-service="${id}"]`);
}

async function restart(page: Page, id: string, label = services.restart): Promise<void> {
    await row(page, id).getByRole('button', { name: label }).click();
    await page.getByRole('dialog').getByRole('button', { name: label }).click();
}

test('lists the services, status-only ones without a button', async ({ page }) => {
    await openUnlocked(page);
    await expect(page.locator('.services__row')).toHaveCount(15);
    await expect(row(page, 'mosquitto').locator('.services__meta')).toContainText(services.state.active);
    await expect(row(page, 'olad').locator('.services__meta')).toHaveText(services.state['not-found']);
    await expect(row(page, 'olad').getByRole('button')).toHaveCount(0);
    for (const id of ['calaos-container', 'haproxy', 'networkd', 'ssh']) {
        await expect(row(page, id).getByRole('button')).toHaveCount(0);
        await expect(row(page, id)).toContainText(services.statusOnly);
    }
    await expect(row(page, 'calaos-ddns').getByRole('button', { name: services.runNow })).toBeVisible();
});

test('a restart asks once, then waits for the new process', async ({ page, mock }) => {
    await openUnlocked(page);
    await row(page, 'mosquitto').getByRole('button', { name: services.restart }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(services.confirmTitle.replace('{name}', services.name.mosquitto));
    await dialog.getByRole('button', { name: MESSAGES.dialog.cancel }).click();
    expect(await restarts(mock)).toEqual([]);

    await restart(page, 'mosquitto');
    await expect(row(page, 'mosquitto').getByRole('button')).toHaveText(services.restarting);
    await expect(row(page, 'mosquitto').locator('.services__result')).toHaveText(services.result.done, {
        timeout: 15_000,
    });
    await expect(row(page, 'mosquitto').getByRole('button')).toHaveText(services.restart);
    expect(await restarts(mock)).toEqual(['mosquitto']);
});

test('restarting calaos-server drops the page, which reconnects and confirms', async ({ page, mock }) => {
    await openUnlocked(page);
    const loginsBefore = (await mock.loginFrames()).length;
    await row(page, 'calaos-server').getByRole('button', { name: services.restart }).click();
    await expect(page.locator('.services__warning')).toHaveText(services.selfRestartWarning);
    await page.getByRole('dialog').getByRole('button', { name: services.restart }).click();

    await expect(page.locator('.services__banner')).toHaveText(services.selfRestarting);
    await expect.poll(async () => (await mock.loginFrames()).length, { timeout: 15_000 }).toBe(loginsBefore + 1);
    await expect(row(page, 'calaos-server').locator('.services__result')).toHaveText(services.result.done, {
        timeout: 20_000,
    });
    await expect(page.locator('.services__banner')).toHaveCount(0);
    // Still unlocked with the same session, and nothing reported as an error.
    await expect(adminScreen(page).adminPassword).toHaveCount(0);
    expect((await mock.adminStatus()).sessions).toBe(1);
    await expect(page.locator('.services__result--danger')).toHaveCount(0);
});

test('a unit that does not come back is failed; one gone missing is not installed', async ({ page, mock }) => {
    await openUnlocked(page);
    await configure(mock, { restartMs: 500, fail: 'grafana' });
    await restart(page, 'grafana');
    await expect(row(page, 'grafana').locator('.services__result')).toHaveText(services.result.failed, {
        timeout: 15_000,
    });
    await expect(row(page, 'grafana').locator('.services__light--failed')).toBeVisible();

    await row(page, 'envoy').getByRole('button', { name: services.restart }).click();
    await configure(mock, { state: { envoy: 'not-found' } });
    await page.getByRole('dialog').getByRole('button', { name: services.restart }).click();
    await expect(row(page, 'envoy').locator('.services__result')).toHaveText(services.result.not_found, {
        timeout: 15_000,
    });
});

test('an upgrade started elsewhere refuses the restart with its own message', async ({ page, mock }) => {
    await openUnlocked(page);
    await configure(mock, { upgradeInProgress: true });
    await restart(page, 'zigbee2mqtt');
    await expect(row(page, 'zigbee2mqtt').locator('.services__result')).toHaveText(
        services.result.upgrade_in_progress,
    );
    await expect(row(page, 'zigbee2mqtt').getByRole('button')).toHaveText(services.restart);
    expect(await restarts(mock)).toEqual([]);
});
