// The Box time card against the mock's clock: the drift against this
// browser, "Set from this device" only while unsynchronised, the confirm
// above an hour, the time zone and its restart offer, a partial failure.

import T from '../app/src/i18n/admin/time.en.json';
import { MESSAGES, adminScreen, expect, loginAs, test } from './fixtures';
import type { MockControl } from './fixtures';
import type { Page } from '@playwright/test';

const ADMIN_PASSWORD = 'correct horse battery';

interface TimeStatus {
    timezone: string;
    ntp: boolean;
    synchronized: boolean;
    offsetMs: number;
    sets: Record<string, unknown>[];
}

async function timeStatus(mock: MockControl): Promise<TimeStatus> {
    return (await mock.send<{ time: TimeStatus }>({ op: 'admin_status' })).time;
}

async function configure(mock: MockControl, patch: Record<string, unknown>): Promise<void> {
    const op = { op: 'admin' as const, ...patch };
    await mock.send(op);
}

async function openAdmin(page: Page): Promise<void> {
    await page.goto('/');
    await loginAs(page);
    const admin = adminScreen(page);
    await admin.tab.click();
    await admin.adminPassword.fill(ADMIN_PASSWORD);
    await admin.submit.click();
    await expect(admin.updates).toBeVisible();
    await expect(card(page).locator('.time__clock')).toBeVisible();
}

const card = (page: Page) => page.locator('section.time');
const fill = (text: string, values: Record<string, string | number>) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key]));
const dialog = (page: Page) => page.getByRole('dialog');

test.beforeEach(async ({ mock }) => {
    await mock.reset();
    await mock.admin({ password: ADMIN_PASSWORD });
});

test('a synchronised box: in step, NTP on, no way to set it by hand', async ({ page }) => {
    await openAdmin(page);
    await expect(card(page)).toContainText(T.inStep);
    await expect(card(page)).toContainText(T.synchronized);
    await expect(card(page).locator('.time__face')).toHaveClass(/time__face--ok/);
    await expect(card(page).getByRole('button', { name: T.setFromDevice })).toHaveCount(0);
    await expect(card(page).getByRole('button', { name: T.useNtp })).toHaveCount(0);
    await expect(card(page).getByLabel(T.timezone)).toHaveValue('Europe/Paris');
});

test('warns past 5 s of drift, and sets the time from this device once confirmed', async ({ page, mock }) => {
    await configure(mock, { time: { offsetMs: 40_000, ntp: false, synchronized: false } });
    await openAdmin(page);
    await expect(card(page).locator('.time__face')).toHaveClass(/time__face--warn/);
    // The box reports whole seconds: 39 or 40 s, depending on when it was read.
    await expect(card(page)).toContainText(new RegExp(fill(T.ahead, { amount: '(39|40) s' })));
    await expect(card(page)).toContainText(T.manual);
    await expect(card(page).locator('.time__strong')).toHaveCount(0);

    await card(page).getByRole('button', { name: T.setFromDevice }).click();
    await expect(dialog(page)).toContainText(T.deviceConfirmTitle);
    // Under an hour: no step warning.
    await expect(dialog(page).locator('.time__dialog-strong')).toHaveCount(0);
    await dialog(page).getByRole('button', { name: T.deviceConfirm }).click();

    await expect.poll(async () => (await timeStatus(mock)).sets).toHaveLength(1);
    const [sent] = (await timeStatus(mock)).sets;
    // NTP was already off: only the time.
    expect(Object.keys(sent)).toEqual(['time']);
    expect(Math.abs(Date.parse(String(sent.time)) - Date.now())).toBeLessThan(5_000);
    await expect(card(page)).toContainText(T.inStep);
});

test('over an hour off: a strong warning, and the step is confirmed with its size', async ({ page, mock }) => {
    await configure(mock, { time: { offsetMs: -3 * 3_600_000, ntp: true, synchronized: false } });
    await openAdmin(page);
    await expect(card(page).locator('.time__face')).toHaveClass(/time__face--strong/);
    await expect(card(page)).toContainText(fill(T.behind, { amount: '3 h' }));
    await expect(card(page)).toContainText(T.strongHint);
    await expect(card(page)).toContainText(T.notSynchronized);

    await card(page).getByRole('button', { name: T.setFromDevice }).click();
    await expect(dialog(page)).toContainText(fill(T.stepWarning, { amount: '3 h' }));
    await dialog(page).getByRole('button', { name: MESSAGES.dialog.cancel }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect((await timeStatus(mock)).sets).toEqual([]);

    await card(page).getByRole('button', { name: T.setFromDevice }).click();
    await dialog(page).getByRole('button', { name: T.deviceConfirm }).click();
    await expect.poll(async () => (await timeStatus(mock)).sets).toHaveLength(1);
    // NTP first, then the time: the daemon refuses a time while NTP is on.
    expect(Object.keys((await timeStatus(mock)).sets[0]).sort()).toEqual(['ntp', 'time']);
    expect((await timeStatus(mock)).sets[0].ntp).toBe(false);
    await expect(card(page)).toContainText(T.inStep);
    await expect(card(page)).toContainText(T.manual);
});

test('"Use NTP" on a clock hours off asks first', async ({ page, mock }) => {
    await configure(mock, { time: { offsetMs: 5 * 3_600_000, ntp: false, synchronized: false } });
    await openAdmin(page);
    await card(page).getByRole('button', { name: T.useNtp }).click();
    await expect(dialog(page)).toContainText(T.ntpConfirmTitle);
    await expect(dialog(page)).toContainText(fill(T.stepWarning, { amount: '5 h' }));
    await dialog(page).getByRole('button', { name: T.useNtp }).click();
    await expect.poll(async () => (await timeStatus(mock)).sets).toEqual([{ ntp: true }]);
    await expect(card(page)).toContainText(T.synchronized);
    // Synchronised again: setting the time by hand is gone.
    await expect(card(page).getByRole('button', { name: T.setFromDevice })).toHaveCount(0);
});

test('a new time zone offers to restart Calaos server and Calaos Home', async ({ page, mock }) => {
    await configure(mock, { services: { dropOnSelfRestart: false } });
    await openAdmin(page);
    await card(page).getByLabel(T.timezone).selectOption('Europe/London');
    await card(page).getByRole('button', { name: T.applyZone }).click();
    await expect(card(page)).toContainText(T.restartRequired);
    await expect.poll(async () => (await timeStatus(mock)).timezone).toBe('Europe/London');

    await card(page).getByRole('button', { name: T.restartKiosk }).click();
    await expect(card(page).getByRole('button', { name: T.restartKiosk })).toHaveCount(0);
    await card(page).getByRole('button', { name: T.restartServer }).click();
    await expect(card(page).locator('.time__restart')).toHaveCount(0);
    const status = await mock.send<{ services: { restarts: string[] } }>({ op: 'admin_status' });
    expect(status.services.restarts).toEqual(['calaos-home', 'calaos-server']);
});

test('no Calaos Home button when its unit is not installed', async ({ page, mock }) => {
    await configure(mock, { services: { state: { 'calaos-home': 'not-found' } } });
    await openAdmin(page);
    await card(page).getByLabel(T.timezone).selectOption('UTC');
    await card(page).getByRole('button', { name: T.applyZone }).click();
    await expect(card(page).getByRole('button', { name: T.restartServer })).toBeVisible();
    await expect(card(page).getByRole('button', { name: T.restartKiosk })).toHaveCount(0);
});

test('a partial failure says what changed and what did not', async ({ page, mock }) => {
    await configure(mock, { time: { ntp: true, synchronized: false, failStep: 'time' } });
    await openAdmin(page);
    await card(page).getByRole('button', { name: T.setFromDevice }).click();
    await dialog(page).getByRole('button', { name: T.deviceConfirm }).click();
    await expect(card(page).locator('.time__partial')).toHaveText(
        fill(T.partial, { applied: T.step.ntp, failed: T.step.time }),
    );
    await expect(card(page).locator('.time__error')).toContainText(MESSAGES.admin.error.internal);
    // The step that went through shows: NTP is now off.
    await expect(card(page)).toContainText(T.manual);
});

async function unlockOnly(page: Page): Promise<void> {
    await page.goto('/');
    await loginAs(page);
    const admin = adminScreen(page);
    await admin.tab.click();
    await admin.adminPassword.fill(ADMIN_PASSWORD);
    await admin.submit.click();
    await expect(admin.updates).toBeVisible();
}

test('an older daemon: the card says to update the box, and the Admin page stays unlocked', async ({ page, mock }) => {
    await mock.admin({ tooOld: ['time_get', 'time_zones'] });
    await unlockOnly(page);
    await expect(card(page).locator('.time__error')).toContainText(MESSAGES.admin.error.daemon_too_old);
    // Nothing flips the page to "being activated" and back.
    await page.waitForTimeout(6_000);
    await expect(adminScreen(page).updates).toBeVisible();
    await expect(adminScreen(page).adminPassword).toHaveCount(0);
    expect((await mock.adminActions()).filter((action) => action === 'time_get')).toHaveLength(1);
});

test('calaos_server stops waiting on a new zone: read back, the restart offered, nothing sent twice', async ({ page, mock }) => {
    await configure(mock, { time: { unknownOutcome: true } });
    await openAdmin(page);
    await card(page).getByLabel(T.timezone).selectOption('Europe/London');
    await card(page).getByRole('button', { name: T.applyZone }).click();
    await expect(card(page).locator('.time__unconfirmed')).toContainText(fill(T.unconfirmed.changed, { changed: T.step.timezone }));
    await expect(card(page).locator('.time__restart')).toContainText(T.restartRequired);
    await expect(card(page).locator('.time__error')).toHaveCount(0);
    await expect(card(page).getByLabel(T.timezone)).toHaveValue('Europe/London');
    expect((await mock.adminActions()).filter((action) => action === 'time_set')).toHaveLength(1);
    await expect(adminScreen(page).adminPassword).toHaveCount(0);
});

test('calaos_server stops waiting on a change that did not take: the card says nothing changed', async ({ page, mock }) => {
    await configure(mock, { time: { unknownOutcome: 'unapplied' } });
    await openAdmin(page);
    await card(page).getByLabel(T.timezone).selectOption('UTC');
    await card(page).getByRole('button', { name: T.applyZone }).click();
    // The first read may beat the daemon: no invitation to apply again until a later read.
    const note = card(page).locator('.time__unconfirmed');
    await expect(note).toContainText(T.unconfirmed.unchangedSoFar);
    await expect(note).toContainText(T.unconfirmed.stillApplying);
    await expect(note.getByRole('button', { name: T.unconfirmed.check })).toBeVisible();
    await expect(note).toContainText(T.unconfirmed.unchanged);
    await expect(note.getByRole('button', { name: T.unconfirmed.dismiss })).toBeVisible();
    await expect(card(page).locator('.time__restart')).toHaveCount(0);
    await expect(card(page).locator('.time__error')).toHaveCount(0);
    expect((await timeStatus(mock)).timezone).toBe('Europe/Paris');
    expect((await mock.adminActions()).filter((action) => action === 'time_set')).toHaveLength(1);
});
