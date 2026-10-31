// The Settings page against the mock's registry: one editor per type,
// the registry's refusal under its row, a write-only secret, the restart
// notice, the backup zip and the restore of one across the restart it causes.

import { readFile } from 'node:fs/promises';
import { constants, deflateRawSync } from 'node:zlib';
import { LOGIN_URL, MESSAGES, adminScreen, expect, loginAs, loginForm, test } from './fixtures';
import type { ControlOp, MockControl } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import cfg from '../app/src/i18n/admin/config.en.json';

const ADMIN_PASSWORD = 'correct horse battery';

interface ConfigStatus {
    values: Record<string, string>;
    sets: string[];
    backups: number;
    restores: { dry_run: boolean; files: string[] }[];
}

async function configStatus(mock: MockControl): Promise<ConfigStatus> {
    return ((await mock.adminStatus()) as unknown as { config: ConfigStatus }).config;
}

/** The config and services knobs of `{op:'admin'}`, which AdminPatch does not spell out. */
/** The last screenshot of a test must show the message, not its fade-in. */
async function expectFadedIn(message: Locator): Promise<void> {
    await expect(message).toHaveCSS('opacity', '1');
}

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

function crc32(bytes: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/** Walks the local headers of a zip of stored entries, checking each CRC. */
function storedEntries(zip: Buffer): Map<string, string> {
    const entries = new Map<string, string>();
    for (let at = 0; zip.readUInt32LE(at) === 0x04034b50; ) {
        const method = zip.readUInt16LE(at + 8);
        const crc = zip.readUInt32LE(at + 14);
        const size = zip.readUInt32LE(at + 18);
        const nameLength = zip.readUInt16LE(at + 26);
        const start = at + 30 + nameLength + zip.readUInt16LE(at + 28);
        const data = zip.subarray(start, start + size);
        expect(method).toBe(0);
        expect(crc32(data)).toBe(crc);
        entries.set(zip.toString('latin1', at + 30, at + 30 + nameLength), data.toString('utf8'));
        at = start + size;
    }
    return entries;
}

const IO_XML = '<?xml version="1.0"?>\n<calaos:ioconfig xmlns:calaos="http://www.calaos.fr" format="2"/>\n';
const RULES_XML = '<?xml version="1.0"?>\n<calaos:rules xmlns:calaos="http://www.calaos.fr"/>\n';

/** io.xml says 1 KiB and inflates to 4 GiB, from a zip under the 8 MiB limit. */
function zipBomb(): { zip: Buffer; packed: number } {
    // A sync flush ends on a byte boundary, so the same run chains into one deflate stream.
    const run = deflateRawSync(Buffer.alloc(64 * 1024 * 1024), { finishFlush: constants.Z_SYNC_FLUSH });
    const lastEmptyBlock = Buffer.from([1, 0, 0, 0xff, 0xff]);
    const data = Buffer.concat([...Array.from({ length: 64 }, () => run), lastEmptyBlock]);
    const name = Buffer.from('io.xml');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(1024, 24);
    central.writeUInt16LE(name.length, 28);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length + name.length, 12);
    end.writeUInt32LE(local.length + name.length + data.length, 16);
    return { zip: Buffer.concat([local, name, data, central, name, end]), packed: data.length };
}

function localConfigXml(user: string, pass: string): string {
    return (
        '<?xml version="1.0"?>\n<calaos:config xmlns:calaos="http://www.calaos.fr">\n' +
        `  <calaos:option name="cn_user" value="${user}"/>\n` +
        `  <calaos:option name="cn_pass" value="${pass}"/>\n</calaos:config>\n`
    );
}

function backupJson(files: Record<string, string>): { name: string; mimeType: string; buffer: Buffer } {
    const doc = {
        format: 'calaos-config-backup/2',
        created_at: '2026-10-25T09:12:58Z',
        server_version: '4.6.0',
        hostname: 'maison',
        io_format: 2,
        files,
    };
    return { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) };
}

const restoreRow = (page: Page) => page.locator('.config__row').nth(1);

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

test('the backup warns about its secrets, then downloads as a zip of five entries with valid CRCs', async ({ page, mock }) => {
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
    expect(name).toMatch(/^calaos-backup-MaisonBox..x-\d{8}-\d{4}\.zip$/);
    await expect(backupRow).toContainText(name);

    const entries = storedEntries(await readFile(await file.path()));
    expect([...entries.keys()]).toEqual(['io.xml', 'rules.xml', 'local_config.xml', 'calaos-backup.json', 'README.txt']);

    const manifest = JSON.parse(entries.get('calaos-backup.json') ?? '') as Record<string, unknown>;
    expect(manifest.format).toBe('calaos-backup/2');
    expect(manifest.hostname).toBe('Maison Box/../x');
    expect(manifest.io_format).toBe(2);
    expect(manifest.files).toEqual(['io.xml', 'rules.xml', 'local_config.xml']);
    expect(manifest.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const stamp = String(manifest.created_at).replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
    expect(name).toBe(`calaos-backup-MaisonBox..x-${stamp}.zip`);
    expect(entries.get('local_config.xml')).toContain('cn_pass');
    expect(entries.get('README.txt')).toContain('ddns');
});

test('a backup warns about the files the box would refuse to restore, and the zip stays the same', async ({ page, mock }) => {
    const causes = ['not_loaded', 'missing', 'unreadable', 'empty', 'refused'];
    await patchAdmin(mock, { config: { unrestorable: causes.map((cause, i) => ({ file: ['io.xml', 'rules.xml', 'local_config.xml'][i % 3], cause })) } });
    await openUnlocked(page);
    const backupRow = page.locator('.config__row').first();
    await backupRow.getByRole('button', { name: cfg.backupConfirm }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('dialog').getByRole('button', { name: cfg.backupConfirm }).click();
    const file = await download;

    const note = backupRow.locator('.unrestorable');
    await expect(note).toContainText(cfg.unrestorableIntro);
    for (const cause of causes) {
        await expect(note).toContainText((cfg.unrestorableCause as Record<string, string>)[cause]);
    }
    await expectFadedIn(note);

    const entries = storedEntries(await readFile(await file.path()));
    expect([...entries.keys()]).toEqual(['io.xml', 'rules.xml', 'local_config.xml', 'calaos-backup.json', 'README.txt']);
    const manifest = JSON.parse(entries.get('calaos-backup.json') ?? '') as Record<string, unknown>;
    expect(Object.keys(manifest).sort()).toEqual(['created_at', 'files', 'format', 'hostname', 'io_format', 'server_version']);
    expect([...entries.values()].join('')).not.toContain('not_loaded');
});

test('a healthy backup shows no warning', async ({ page }) => {
    await openUnlocked(page);
    const backupRow = page.locator('.config__row').first();
    await backupRow.getByRole('button', { name: cfg.backupConfirm }).click();
    await page.getByRole('dialog').getByRole('button', { name: cfg.backupConfirm }).click();
    await expect(backupRow.locator('.config__row-note')).toBeVisible();
    await expect(backupRow.locator('.unrestorable')).toHaveCount(0);
});

test('the safety copy before a restore warns too, and the restore goes on', async ({ page, mock }) => {
    await patchAdmin(mock, { config: { unrestorable: [{ file: 'rules.xml', cause: 'from_the_future' }] } });
    await openUnlocked(page);
    await restoreRow(page).locator('input[type="file"]').setInputFiles([
        { name: 'io.xml', mimeType: 'text/xml', buffer: Buffer.from(IO_XML) },
        { name: 'rules.xml', mimeType: 'text/xml', buffer: Buffer.from(RULES_XML) },
    ]);
    const dialog = page.getByRole('dialog');
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: cfg.restoreConfirm }).click();
    await download;
    const note = page.locator('.unrestorable');
    await expect(note).toContainText(cfg.unrestorableSafety);
    await expect(note).toContainText('rules.xml');
    await expect(note).toContainText(cfg.unrestorableCause.unknown);
    await expect(page.locator('.config__restored')).toBeVisible({ timeout: 15_000 });
    await expect(note).toContainText(cfg.unrestorableSafety);
    await expect(note).toContainText('rules.xml');
    expect((await configStatus(mock)).restores.map((restore) => restore.dry_run)).toEqual([true, false]);
});

test('the safety copy warning is still told on the sign-in page after a changed household login', async ({ page, mock }) => {
    await patchAdmin(mock, { config: { unrestorable: [{ file: 'rules.xml', cause: 'refused' }] } });
    await restoreChangingHousehold(page, true);
    const note = page.locator('.unrestorable');
    await expect(note).toContainText(cfg.unrestorableSafety);
    await expect(note).toContainText('rules.xml');
    await expect(note).toContainText(cfg.unrestorableCause.refused);
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

test('a restore shows the dry run, then restarts and tells where the previous files are', async ({ page, mock }) => {
    await patchAdmin(mock, { config: { restore: { warnings: ['mcp_token_changes', 'ddns_changes', 'invalid_options', 'devices_removed'] } } });
    await openUnlocked(page);

    // The backup zip of this very box is the file a real user comes back with.
    await page.locator('.config__row').first().getByRole('button', { name: cfg.backupConfirm }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('dialog').getByRole('button', { name: cfg.backupConfirm }).click();
    const zipPath = await (await download).path();

    await restoreRow(page).locator('input[type="file"]').setInputFiles({
        name: 'backup.zip',
        mimeType: 'application/zip',
        buffer: await readFile(zipPath),
    });

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(cfg.restoreBackup);
    await expect(dialog.getByRole('rowheader', { name: cfg.restoreCount.ios })).toBeVisible();
    await expect(dialog.getByRole('row', { name: cfg.restoreCount.ios })).toContainText('21');
    await expect(dialog.getByRole('row', { name: cfg.restoreCount.ios })).toContainText('24');
    for (const code of ['mcp_token_changes', 'ddns_changes', 'invalid_options', 'devices_removed']) {
        await expect(dialog.locator(`[data-warning="${code}"]`)).toBeVisible();
    }
    await expect(dialog).toContainText(cfg.restoreKept);
    expect((await configStatus(mock)).restores).toEqual([
        { dry_run: true, files: ['io.xml', 'rules.xml', 'local_config.xml'] },
    ]);

    await dialog.getByRole('checkbox').uncheck();
    await dialog.getByRole('button', { name: cfg.restoreConfirm }).click();

    await expect(page.locator('.config__restart')).toHaveText(cfg.restoreRestarting);
    await expect(page.locator('.config__restored')).toContainText(
        'Configuration restored. The previous one is kept on the box (backups/2026/10/25-10-2026_17-14-15).',
        { timeout: 15_000 },
    );
    const { restores, backups } = await configStatus(mock);
    expect(restores.map((restore) => restore.dry_run)).toEqual([true, false]);
    expect(backups).toBe(1);
    await expect(page).not.toHaveURL(LOGIN_URL);
});

test('a restore downloads the current configuration first unless told not to', async ({ page, mock }) => {
    await openUnlocked(page);
    await restoreRow(page).locator('input[type="file"]').setInputFiles([
        { name: 'io.xml', mimeType: 'text/xml', buffer: Buffer.from(IO_XML) },
        { name: 'rules.xml', mimeType: 'text/xml', buffer: Buffer.from(RULES_XML) },
    ]);
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('[data-warning="no_local_config"]')).toBeVisible();
    await expect(dialog).toContainText(cfg.restoreTitleBare);
    await expect(dialog.getByRole('checkbox')).toBeChecked();

    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: cfg.restoreConfirm }).click();
    expect((await download).suggestedFilename()).toMatch(/\.zip$/);
    await expect(page.locator('.config__restored')).toBeVisible({ timeout: 15_000 });
    expect((await configStatus(mock)).backups).toBe(1);
});

test('the box refuses a backup: the dry run says why and nothing is restored', async ({ page, mock }) => {
    await openUnlocked(page);
    const refused = { 'io.xml': IO_XML.replace('format="2"', 'format="9"'), 'rules.xml': RULES_XML };
    await restoreRow(page).locator('input[type="file"]').setInputFiles(backupJson(refused));
    await expect(restoreRow(page).getByRole('alert')).toContainText('io.xml was made by a newer Calaos (format 9)');
    await expectFadedIn(restoreRow(page).getByRole('alert'));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await configStatus(mock)).restores).toEqual([]);
});

test('a file that is no backup is stopped in the browser, nothing sent', async ({ page, mock }) => {
    await openUnlocked(page);
    await restoreRow(page).locator('input[type="file"]').setInputFiles({
        name: 'notes.zip',
        mimeType: 'application/zip',
        buffer: Buffer.from('these are not the files you are looking for'),
    });
    await expect(restoreRow(page).getByRole('alert')).toHaveText(cfg.restoreError.not_a_zip);
    await expectFadedIn(restoreRow(page).getByRole('alert'));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await configStatus(mock)).restores).toEqual([]);
});

test('a zip bomb is refused with most of it never unpacked', async ({ page, mock }) => {
    await page.addInitScript(() => {
        const Real = window.DecompressionStream;
        const seen = { bytes: 0 };
        Object.assign(window, { inflateInput: seen });
        window.DecompressionStream = class {
            private readonly inner = new Real('deflate-raw');
            readonly readable = this.inner.readable;
            readonly writable = {
                getWriter: () => {
                    const writer = this.inner.writable.getWriter();
                    return {
                        write: (chunk: Uint8Array<ArrayBuffer>) => {
                            seen.bytes += chunk.length;
                            return writer.write(chunk);
                        },
                        close: () => writer.close(),
                    };
                },
            };
        } as unknown as typeof DecompressionStream;
    });
    await openUnlocked(page);
    const { zip, packed } = zipBomb();
    await restoreRow(page).locator('input[type="file"]').setInputFiles({
        name: 'bomb.zip',
        mimeType: 'application/zip',
        buffer: zip,
    });
    await expect(restoreRow(page).getByRole('alert')).toHaveText(cfg.restoreError.entry_too_big);
    const fed = await page.evaluate(() => (window as unknown as { inflateInput: { bytes: number } }).inflateInput.bytes);
    expect(fed).toBeGreaterThan(0);
    expect(fed).toBeLessThan(packed / 4);
    expect((await configStatus(mock)).restores).toEqual([]);
});

test('a failed restore stays in the dialog and says so', async ({ page, mock }) => {
    await patchAdmin(mock, { config: { restore: { fail: 'previous files in backups/2026/x' } } });
    await openUnlocked(page);
    await restoreRow(page).locator('input[type="file"]').setInputFiles(
        backupJson({ 'io.xml': IO_XML, 'rules.xml': RULES_XML }),
    );
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: cfg.restoreConfirm }).click();
    await expect(dialog.getByRole('alert')).toContainText('previous files in backups/2026/x');
    await expect(page.locator('.config__restart')).toHaveCount(0);
});

for (const { code, refuse } of [
    {
        code: 'upgrade_in_progress',
        refuse: (mock: MockControl) => patchAdmin(mock, { config: { restore: { upgrading: true } } }),
    },
    {
        code: 'daemon_too_old',
        refuse: async (mock: MockControl) => {
            await mock.admin({ tooOld: ['config_restore'] });
        },
    },
] as const) {
    const message = MESSAGES.admin.error[code];

    test(`${code} at the dry run: the row says it and no dialog opens`, async ({ page, mock }) => {
        await refuse(mock);
        await openUnlocked(page);
        await restoreRow(page).locator('input[type="file"]').setInputFiles(
            backupJson({ 'io.xml': IO_XML, 'rules.xml': RULES_XML }),
        );
        await expect(restoreRow(page).getByRole('alert')).toHaveText(message);
        await expectFadedIn(restoreRow(page).getByRole('alert'));
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect((await configStatus(mock)).restores).toEqual([]);
    });

    test(`${code} once the dialog is open: it stays open, says it, and nothing is restored`, async ({ page, mock }) => {
        await openUnlocked(page);
        await restoreRow(page).locator('input[type="file"]').setInputFiles(
            backupJson({ 'io.xml': IO_XML, 'rules.xml': RULES_XML }),
        );
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByRole('checkbox')).toBeChecked();
        await refuse(mock);
        await dialog.getByRole('button', { name: cfg.restoreConfirm }).click();
        await expect(dialog.getByRole('alert')).toHaveText(message);
        await expect(dialog.getByRole('button', { name: cfg.restoreConfirm })).toBeEnabled();
        await expect(page.locator('.config__restart')).toHaveCount(0);
        expect((await configStatus(mock)).restores.map((restore) => restore.dry_run)).toEqual([true]);
    });
}

async function restoreChangingHousehold(page: Page, safetyCopy = false): Promise<void> {
    await openUnlocked(page);
    await restoreRow(page).locator('input[type="file"]').setInputFiles(
        backupJson({ 'io.xml': IO_XML, 'rules.xml': RULES_XML, 'local_config.xml': localConfigXml('demo', 'from-the-backup') }),
    );
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('[data-warning="household_login_changes"]')).toBeVisible();
    if (!safetyCopy) await dialog.getByRole('checkbox').uncheck();
    await dialog.getByRole('button', { name: cfg.restoreConfirm }).click();

    await expect(page).toHaveURL(LOGIN_URL, { timeout: 15_000 });
}

test('a changed household login sends the page to sign-in, which says why', async ({ page }) => {
    await restoreChangingHousehold(page);
    await expect(page.locator('#login-restored')).toHaveText(MESSAGES.login.restoredHousehold);
});

test('after a changed household login, the restored password signs in', async ({ page }) => {
    await restoreChangingHousehold(page);
    await loginAs(page, { user: 'demo', pass: 'from-the-backup' });
    await expect(page).not.toHaveURL(LOGIN_URL);
    await expect(loginForm(page).submit).toHaveCount(0);
});
