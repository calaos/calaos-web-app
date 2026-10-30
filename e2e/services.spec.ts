// The services page of the Admin tab against the mock's fake daemon: each
// verb followed until the list shows it, what carries the page's connection
// restarting, a unit that fails, a masked or missing one, and the 409 of an
// upgrade this client did not see start.

import type { Page } from '@playwright/test';
import services from '../app/src/i18n/admin/services.en.json';
import { MESSAGES, adminScreen, expect, loginAs, test } from './fixtures';
import type { ControlOp, MockControl } from './fixtures';

const ADMIN_PASSWORD = 'correct horse battery';

/** `/control {op:'admin', services}` (mock-server/admin-services.mjs `configure`). */
interface ServicesPatch {
    restartMs?: number;
    fail?: string;
    fail_service?: { unit: string; verb: string };
    state?: Record<string, string>;
    startup?: Record<string, string>;
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
    await page.locator('[data-page="services"]').click();
    await expect(page).toHaveURL(/#\/admin\/services$/);
    await expect(page.locator('.services')).toBeVisible();
}

function row(page: Page, id: string) {
    return page.locator(`.services [data-service="${id}"]`);
}

async function restart(page: Page, id: string): Promise<void> {
    await row(page, id).getByRole('button', { name: services.restart, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: services.restart, exact: true }).click();
}

function bootSwitch(page: Page, id: string) {
    return row(page, id).getByRole('switch');
}

test('lists the services, with the verbs each one offers', async ({ page }) => {
    await openUnlocked(page);
    await expect(page.locator('.services__row')).toHaveCount(14);
    await expect(row(page, 'mosquitto').locator('.services__meta')).toContainText(services.state.active);
    await expect(row(page, 'mosquitto').getByRole('button', { name: services.stop })).toBeVisible();
    await expect(row(page, 'olad').locator('.services__meta')).toHaveText(services.state['not-found']);
    await expect(row(page, 'olad').getByRole('button')).toHaveCount(0);
    await expect(row(page, 'hue2mqtt').locator('.services__meta')).toHaveText(services.state.masked);
    await expect(row(page, 'hue2mqtt').getByRole('button')).toHaveCount(0);
    await expect(row(page, 'networkd').getByRole('button')).toHaveCount(0);
    await expect(row(page, 'networkd')).toContainText(services.statusOnly);
    for (const id of ['calaos-container', 'haproxy', 'ssh']) {
        await expect(row(page, id).getByRole('button')).toHaveText([services.restart]);
    }
});

test('a restart asks once, then waits for the new process', async ({ page, mock }) => {
    await openUnlocked(page);
    await row(page, 'mosquitto').getByRole('button', { name: services.restart }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(services.confirmTitle.replace('{name}', services.name.mosquitto));
    await dialog.getByRole('button', { name: MESSAGES.dialog.cancel }).click();
    expect(await restarts(mock)).toEqual([]);

    await restart(page, 'mosquitto');
    await expect(row(page, 'mosquitto').getByRole('button')).toHaveText(services.busy.restart);
    await expect(row(page, 'mosquitto').locator('.services__result')).toHaveText(services.result.done.restart, {
        timeout: 15_000,
    });
    await expect(row(page, 'mosquitto').getByRole('button')).toHaveText([services.restart, services.stop]);
    expect(await restarts(mock)).toEqual(['mosquitto']);
});

test('stopping asks what it costs, then the row offers Start', async ({ page, mock }) => {
    await openUnlocked(page);
    await configure(mock, { restartMs: 200 });
    await row(page, 'mosquitto').getByRole('button', { name: services.stop }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(services.stopTitle.replace('{name}', services.name.mosquitto));
    await expect(dialog).toContainText(services.consequence.mosquitto);
    await dialog.getByRole('button', { name: services.stop, exact: true }).click();

    await expect(row(page, 'mosquitto').locator('.services__result')).toHaveText(services.result.done.stop, {
        timeout: 15_000,
    });
    await expect(row(page, 'mosquitto').getByRole('button')).toHaveText([services.start]);
    await expect(bootSwitch(page, 'mosquitto')).toHaveAttribute('aria-checked', 'true');
});

test('a manual start of a service off at boot says it will not last', async ({ page, mock }) => {
    await openUnlocked(page);
    await configure(mock, { restartMs: 200 });
    await row(page, 'zigbee2mqtt').getByRole('button', { name: services.start }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row(page, 'zigbee2mqtt').locator('.services__result')).toHaveText(services.result.done.start, {
        timeout: 15_000,
    });
    await expect(row(page, 'zigbee2mqtt').locator('.services__note')).toHaveText(services.startNote);
});

test('the boot switch turns a service on and off, asking only to turn it off', async ({ page, mock }) => {
    await openUnlocked(page);
    await configure(mock, { restartMs: 200 });
    const toggle = bootSwitch(page, 'zigbee2mqtt');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row(page, 'zigbee2mqtt').locator('.services__result')).toHaveText(services.result.done.enable, {
        timeout: 15_000,
    });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    await toggle.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(services.disableTitle.replace('{name}', services.name.zigbee2mqtt));
    await dialog.getByRole('button', { name: services.disableConfirm }).click();
    await expect(row(page, 'zigbee2mqtt').locator('.services__result')).toHaveText(services.result.done.disable, {
        timeout: 15_000,
    });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
});

test('the time service leads to the Time card for its on/off', async ({ page }) => {
    await openUnlocked(page);
    await expect(bootSwitch(page, 'ntp')).toHaveCount(0);
    await row(page, 'ntp').getByRole('link', { name: services.timeLink }).click();
    await expect(page).toHaveURL(/#\/admin#time$/);
    await expect(page.locator('.time')).toBeInViewport();
});

test('restarting calaos-server drops the page, which reconnects and confirms', async ({ page, mock }) => {
    await openUnlocked(page);
    const loginsBefore = (await mock.loginFrames()).length;
    await row(page, 'calaos-server').getByRole('button', { name: services.restart }).click();
    await expect(page.locator('.services__warning')).toHaveText(services.restartWarning['calaos-server']);
    await page.getByRole('dialog').getByRole('button', { name: services.restart }).click();

    await expect(page.locator('.services__banner')).toHaveText(
        services.selfRestarting.replace('{name}', services.name['calaos-server']),
    );
    await expect.poll(async () => (await mock.loginFrames()).length, { timeout: 15_000 }).toBe(loginsBefore + 1);
    await expect(row(page, 'calaos-server').locator('.services__result')).toHaveText(services.result.done.restart, {
        timeout: 20_000,
    });
    await expect(page.locator('.services__banner')).toHaveCount(0);
    // Still unlocked with the same session, and nothing reported as an error.
    await expect(adminScreen(page).adminPassword).toHaveCount(0);
    expect((await mock.adminStatus()).sessions).toBe(1);
    await expect(page.locator('.services__result--danger')).toHaveCount(0);
});

test('restarting haproxy reads as a restart, not as a lost box', async ({ page, mock }) => {
    await openUnlocked(page);
    const loginsBefore = (await mock.loginFrames()).length;
    await row(page, 'haproxy').getByRole('button', { name: services.restart }).click();
    await expect(page.locator('.services__warning')).toHaveText(services.restartWarning.haproxy);
    await page.getByRole('dialog').getByRole('button', { name: services.restart, exact: true }).click();
    await expect(page.locator('.services__banner')).toHaveText(
        services.selfRestarting.replace('{name}', services.name.haproxy),
    );
    await expect.poll(async () => (await mock.loginFrames()).length, { timeout: 15_000 }).toBe(loginsBefore + 1);
    await expect(row(page, 'haproxy').locator('.services__result')).toHaveText(services.result.done.restart, {
        timeout: 20_000,
    });
    await expect(adminScreen(page).adminPassword).toHaveCount(0);
});

test('restarting calaos-container waits out the daemon, admin stays unlocked', async ({ page, mock }) => {
    await openUnlocked(page);
    await configure(mock, { restartMs: 3000 });
    await restart(page, 'calaos-container');
    await expect(row(page, 'calaos-container').locator('.services__result')).toHaveText(services.result.done.restart, {
        timeout: 20_000,
    });
    await expect(adminScreen(page).adminPassword).toHaveCount(0);
});

test('a unit that does not come back is failed; one gone missing is not available', async ({ page, mock }) => {
    await openUnlocked(page);
    await configure(mock, { restartMs: 500, fail: 'grafana' });
    await restart(page, 'grafana');
    await expect(row(page, 'grafana').locator('.services__result')).toHaveText(services.result.failed.restart, {
        timeout: 15_000,
    });
    await expect(row(page, 'grafana').locator('.services__light--failed')).toBeVisible();

    await row(page, 'envoy').getByRole('button', { name: services.restart }).click();
    await configure(mock, { state: { envoy: 'not-found' } });
    await page.getByRole('dialog').getByRole('button', { name: services.restart }).click();
    await expect(row(page, 'envoy').locator('.services__result')).toHaveText(
        MESSAGES.admin.error.service_unavailable,
        { timeout: 15_000 },
    );
    await expect(row(page, 'envoy').locator('.services__meta')).toHaveText(services.state['not-found']);
});

test('an upgrade started elsewhere refuses the restart with its own message', async ({ page, mock }) => {
    await openUnlocked(page);
    await configure(mock, { upgradeInProgress: true });
    await restart(page, 'mosquitto');
    await expect(row(page, 'mosquitto').locator('.services__result')).toHaveText(
        services.result.upgrade_in_progress,
    );
    await expect(row(page, 'mosquitto').getByRole('button')).toHaveText([services.restart, services.stop]);
    expect(await restarts(mock)).toEqual([]);
});

test('an older daemon: the services page says to update the box, and the admin session stays', async ({ page, mock }) => {
    await mock.admin({ tooOld: ['services_list'] });
    await openUnlocked(page);
    await expect(page.locator('.services')).toContainText(MESSAGES.admin.error.daemon_too_old);
    await page.waitForTimeout(6_000);
    await expect(page).toHaveURL(/#\/admin\/services$/);
    await expect(adminScreen(page).adminPassword).toHaveCount(0);
    expect((await mock.adminActions()).filter((action) => action === 'services_list')).toHaveLength(1);
});

test('the page says where it is and leads back to the Admin hub', async ({ page }) => {
    await openUnlocked(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(services.title);
    const trail = page.getByRole('navigation', { name: MESSAGES.admin.pages.trail });
    await expect(trail.locator('[aria-current="page"]')).toHaveText(services.title);
    await trail.getByRole('link', { name: MESSAGES.admin.title }).click();
    await expect(page).toHaveURL(/#\/admin$/);
    await expect(adminScreen(page).updates).toBeVisible();
});
