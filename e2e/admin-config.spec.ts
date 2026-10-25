// The Settings page against the mock's registry: one editor per type,
// the registry's refusal under its row, a write-only secret, the restart
// notice, and the backup download with its file name and JSON shape.

import { readFile } from 'node:fs/promises';
import { MESSAGES, adminScreen, expect, loginAs, test } from './fixtures';
import type { ControlOp, MockControl } from './fixtures';
import type { Page } from '@playwright/test';
import cfg from '../app/src/i18n/admin/config.en.json';

const ADMIN_PASSWORD = 'correct horse battery';

interface ConfigStatus {
    values: Record<string, string>;
    sets: string[];
    backups: number;
}

async function configStatus(mock: MockControl): Promise<ConfigStatus> {
    return ((await mock.adminStatus()) as unknown as { config: ConfigStatus }).config;
}

/** The config and services knobs of `{op:'admin'}`, which AdminPatch does not spell out. */
async function patchAdmin(mock: MockControl, patch: Record<string, unknown>): Promise<void> {
    await mock.send({ op: 'admin', ...patch } as ControlOp);
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
    await admin.adminPassword.fill(ADMIN_PASSWORD);
    await admin.submit.click();
    await expect(admin.updates).toBeVisible();
    await page.locator('[data-page="settings"]').click();
    await expect(page).toHaveURL(/#\/admin\/settings$/);
}

async function openSettings(page: Page): Promise<void> {
    await openUnlocked(page);
    await expect(row(page, 'smtp_auth')).toBeVisible();
}

function row(page: Page, key: string) {
    return page.locator(`.config-row[data-key="${key}"]`);
}

test('a switch and a list save as they change; a restart key raises the notice', async ({ page, mock }) => {
    // The registry also stores a bool as `1`.
    await patchAdmin(mock, { config: { values: { ota_enabled: '1' } } });
    await openSettings(page);
    await expect(row(page, 'ota_enabled').getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.config__group-title').first()).toHaveText(cfg.group.Logging);

    const auth = row(page, 'smtp_auth').getByRole('switch');
    await expect(auth).toHaveAttribute('aria-checked', 'false');
    await auth.click();
    await expect(auth).toHaveAttribute('aria-checked', 'true');
    await expect(row(page, 'smtp_auth')).toContainText(cfg.saved);
    expect((await configStatus(mock)).values.smtp_auth).toBe('true');
    // A live key: no restart asked.
    await expect(page.locator('.config__restart')).toHaveCount(0);

    const version = row(page, 'influxdb_version').getByRole('combobox');
    await expect(version).toHaveValue('1');
    await version.selectOption('2');
    await expect.poll(async () => (await configStatus(mock)).values.influxdb_version).toBe('2');
    await expect(row(page, 'influxdb_version')).toContainText(cfg.afterRestart);
    const notice = page.locator('.config__restart');
    await expect(notice).toContainText(cfg.restartRequired);

    await patchAdmin(mock, { services: { dropOnSelfRestart: false } });
    await notice.getByRole('button', { name: cfg.restartNow }).click();
    await expect(notice).toContainText(cfg.restarting);
    const restarts = (await mock.log()).filter(
        (entry) => entry.frame?.msg === 'admin' && entry.frame?.data?.action === 'services_restart',
    );
    const params = restarts.map((entry) => (entry.frame?.data as unknown as { params?: { unit?: string } }).params);
    expect(params).toEqual([{ unit: 'calaos-server' }]);
});

test('a typed number saves on demand, the registry refuses one out of range, and the default comes back', async ({
    page,
    mock,
}) => {
    await openSettings(page);
    const port = row(page, 'smtp_port');
    const field = port.getByRole('textbox');
    const save = port.getByRole('button', { name: cfg.save });
    await expect(field).toHaveValue('');
    await expect(save).toBeDisabled();

    await field.fill('70000');
    await save.click();
    const error = port.getByRole('alert');
    await expect(error).toContainText('smtp_port must be between 1 and 65535');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    expect((await configStatus(mock)).values.smtp_port).toBeUndefined();

    await field.fill('587');
    await field.press('Enter');
    await expect(port.getByRole('alert')).toHaveCount(0);
    await expect(port).toContainText(cfg.saved);
    expect((await configStatus(mock)).values.smtp_port).toBe('587');

    await port.getByRole('button', { name: cfg.reset }).click();
    await expect(field).toHaveValue('');
    expect((await configStatus(mock)).values.smtp_port).toBeUndefined();

    // A float and an e-mail list are text fields too, validated by the registry.
    const latitude = row(page, 'latitude').getByRole('textbox');
    await expect(latitude).toHaveAttribute('inputmode', 'decimal');
    await latitude.fill('43.2965');
    await row(page, 'latitude').getByRole('button', { name: cfg.save }).click();
    await expect.poll(async () => (await configStatus(mock)).values.latitude).toBe('43.2965');

    const mails = row(page, 'user_emails');
    await mails.getByRole('textbox').fill('not-an-address');
    await mails.getByRole('button', { name: cfg.save }).click();
    await expect(mails.getByRole('alert')).toContainText('e-mail');
});

test('a secret is written, never shown', async ({ page, mock }) => {
    await openSettings(page);
    const password = row(page, 'smtp_password');
    await expect(password).toContainText(cfg.secretSet);
    await expect(password.getByRole('textbox')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('mock-smtp-secret');

    const token = row(page, 'influxdb_token');
    await expect(token).toContainText(cfg.secretUnset);
    await token.getByRole('button', { name: cfg.secretChange }).click();
    const dialog = page.getByRole('dialog');
    const field = dialog.getByLabel(cfg.secretLabel);
    await expect(field).toHaveAttribute('type', 'password');
    await expect(field).toHaveValue('');
    await field.fill('influx-new-token');
    await dialog.getByRole('button', { name: cfg.secretConfirm }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(token).toContainText(cfg.secretSet);
    expect((await configStatus(mock)).values.influxdb_token).toBe('influx-new-token');
    await expect(page.locator('body')).not.toContainText('influx-new-token');
    await expect(page.locator('.config__restart')).toContainText(cfg.restartRequired);

    // Saving it empty removes it.
    await password.getByRole('button', { name: cfg.secretChange }).click();
    await page.getByRole('dialog').getByRole('button', { name: cfg.secretConfirm }).click();
    await expect(password).toContainText(cfg.secretUnset);
    expect((await configStatus(mock)).values.smtp_password).toBeUndefined();
});

test('the backup warns about its secrets, then downloads under the server name as JSON', async ({ page, mock }) => {
    await patchAdmin(mock, { config: { hostname: 'Maison Box/../x' } });
    await openUnlocked(page);
    const backupRow = page.locator('.config__row').first();
    await backupRow.getByRole('button', { name: cfg.backupConfirm }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(cfg.backupWarning);
    expect((await configStatus(mock)).backups).toBe(0);

    const request = page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api');
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: cfg.backupConfirm }).click();

    const sent = await request;
    expect(new URL(sent.url()).search).toBe('');
    const body = sent.postDataJSON() as Record<string, string>;
    expect(body.action).toBe('config_backup');
    expect(body.admin_session).toEqual(expect.any(String));
    expect(body.admin_session).not.toBe('');

    const file = await download;
    const name = file.suggestedFilename();
    expect(name).toMatch(/^calaos-backup-MaisonBox..x-\d{8}-\d{4}\.json$/);
    await expect(backupRow).toContainText(name);

    const path = await file.path();
    const doc = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(doc).sort()).toEqual(['created_at', 'files', 'format', 'hostname', 'server_version']);
    expect(doc.format).toBe('calaos-config-backup/1');
    expect(doc.hostname).toBe('Maison Box/../x');
    expect(doc.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const stamp = String(doc.created_at).replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
    expect(name).toBe(`calaos-backup-MaisonBox..x-${stamp}.json`);
    const files = doc.files as Record<string, unknown>;
    expect(Object.keys(files).sort()).toEqual(['io.xml', 'local_config.xml', 'rules.xml', 'widgets.xml']);
    for (const content of Object.values(files)) expect(typeof content).toBe('string');
    expect(files['local_config.xml']).toContain('cn_pass');
});

test('a backup refused for an ended session asks for the password again', async ({ page, mock }) => {
    await openUnlocked(page);
    await mock.admin({ clearSessions: true });
    await page.locator('.config__row').first().getByRole('button', { name: cfg.backupConfirm }).click();
    await page.getByRole('dialog').getByRole('button', { name: cfg.backupConfirm }).click();
    await expect(adminScreen(page).heading).toHaveText(MESSAGES.admin.unlock.title);
});

test('an older daemon: the settings page says to update the box, and the admin session stays', async ({ page, mock }) => {
    await mock.admin({ tooOld: ['config_list'] });
    await openUnlocked(page);
    await expect(page.locator('.config__status--error')).toContainText(MESSAGES.admin.error.daemon_too_old);
    await page.waitForTimeout(6_000);
    await expect(page).toHaveURL(/#\/admin\/settings$/);
    await expect(adminScreen(page).adminPassword).toHaveCount(0);
    await expect(page.locator('.config__status--error')).toBeVisible();
    expect((await mock.adminActions()).filter((action) => action === 'config_list')).toHaveLength(1);
});
