// The Date and time page against the mock's clock: the drift against this
// browser, "Set from this device" only while unsynchronised, the confirm
// above an hour, the time zone and its restart offer, a partial failure.

import T from '../app/src/i18n/admin/time.en.json';
import { MESSAGES, adminScreen, expect, loginAs, test } from './fixtures';
import type { MockControl } from './fixtures';
import type { Page } from '@playwright/test';

const ADMIN_PASSWORD = 'correct horse battery';

// Never the box's zone (Europe/Paris, Asia/Tokyo here): a time read in the
// browser's zone would be caught.
test.use({ timezoneId: 'America/Los_Angeles' });

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
    await page.locator('[data-page="time"]').click();
    await expect(page).toHaveURL(/#\/admin\/time$/);
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

test('a synchronised box: in step, NTP on, no way to set it from this device', async ({ page }) => {
    await openAdmin(page);
    await expect(card(page)).toContainText(T.inStep);
    await expect(card(page)).toContainText(T.synchronized);
    await expect(card(page).locator('.time__face')).toHaveClass(/time__face--ok/);
    await expect(card(page).getByRole('button', { name: T.setFromDevice })).toHaveCount(0);
    await expect(card(page).getByRole('button', { name: T.useNtp })).toHaveCount(0);
    await expect(card(page).getByLabel(T.timezone, { exact: true })).toHaveValue('Europe/Paris');
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
    // Synchronised again: "Set from this device" is gone.
    await expect(card(page).getByRole('button', { name: T.setFromDevice })).toHaveCount(0);
});

test('a new time zone offers to restart Calaos server and Calaos Home', async ({ page, mock }) => {
    await configure(mock, { services: { dropOnSelfRestart: false } });
    await openAdmin(page);
    await card(page).getByLabel(T.timezone, { exact: true }).selectOption('Europe/London');
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
    await card(page).getByLabel(T.timezone, { exact: true }).selectOption('UTC');
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

test('an older daemon: the page says to update the box, and the Admin page stays unlocked', async ({ page, mock }) => {
    await mock.admin({ tooOld: ['time_get', 'time_zones'] });
    await unlockOnly(page);
    await page.locator('[data-page="time"]').click();
    await expect(card(page).locator('.time__error')).toContainText(MESSAGES.admin.error.daemon_too_old);
    // Nothing flips the page to "being activated" and back.
    await page.waitForTimeout(6_000);
    await expect(page).toHaveURL(/#\/admin\/time$/);
    await expect(card(page).locator('.time__error')).toBeVisible();
    await expect(adminScreen(page).adminPassword).toHaveCount(0);
    expect((await mock.adminActions()).filter((action) => action === 'time_get')).toHaveLength(1);
});

test('calaos_server stops waiting on a new zone: read back, the restart offered, nothing sent twice', async ({ page, mock }) => {
    await configure(mock, { time: { unknownOutcome: true } });
    await openAdmin(page);
    await card(page).getByLabel(T.timezone, { exact: true }).selectOption('Europe/London');
    await card(page).getByRole('button', { name: T.applyZone }).click();
    await expect(card(page).locator('.time__unconfirmed')).toContainText(fill(T.unconfirmed.changed, { changed: T.step.timezone }));
    await expect(card(page).locator('.time__restart')).toContainText(T.restartRequired);
    await expect(card(page).locator('.time__error')).toHaveCount(0);
    await expect(card(page).getByLabel(T.timezone, { exact: true })).toHaveValue('Europe/London');
    expect((await mock.adminActions()).filter((action) => action === 'time_set')).toHaveLength(1);
    await expect(adminScreen(page).adminPassword).toHaveCount(0);
});

test('calaos_server stops waiting on a change that did not take: the page says nothing changed', async ({ page, mock }) => {
    await configure(mock, { time: { unknownOutcome: 'unapplied' } });
    await openAdmin(page);
    await card(page).getByLabel(T.timezone, { exact: true }).selectOption('UTC');
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

test('the entry opens the page at its own URL: back returns to the hub, a reload asks to log in again', async ({ page }) => {
    await openAdmin(page);
    await page.goBack();
    await expect(adminScreen(page).updates).toBeVisible();
    // The page left the hub.
    await expect(card(page)).toHaveCount(0);
    await page.goForward();
    await expect(card(page).locator('.time__clock')).toBeVisible();
    await page.reload();
    // Nothing survives a reload: the app asks for the login again.
    await expect(page).toHaveURL(/#\/login/);
    await expect(card(page)).toHaveCount(0);
});

const manualInput = (page: Page) => card(page).getByLabel(T.manualTitle, { exact: true });

test('a time typed by hand, NTP off: only the time is sent, read in the box zone and not the browser one', async ({ page, mock }) => {
    await configure(mock, { time: { ntp: false, synchronized: false, timezone: 'Asia/Tokyo' } });
    await openAdmin(page);
    await manualInput(page).fill('2027-01-15T08:30');
    await card(page).getByRole('button', { name: T.manualSet, exact: true }).click();
    // Months off the box clock: confirmed with its size.
    await expect(dialog(page)).toContainText(T.manualConfirmTitle);
    await dialog(page).getByRole('button', { name: T.manualConfirm }).click();
    await expect.poll(async () => (await timeStatus(mock)).sets).toHaveLength(1);
    // Tokyo is UTC+9, whatever the browser's zone is.
    expect((await timeStatus(mock)).sets[0]).toEqual({ time: '2027-01-14T23:30:00Z' });
});

test('a time typed by hand while NTP is on: confirmed first, then ntp:false and time in one request', async ({ page, mock }) => {
    await openAdmin(page);
    await manualInput(page).fill('2026-07-01T12:00');
    await card(page).getByRole('button', { name: T.manualSet, exact: true }).click();
    await expect(dialog(page)).toContainText(T.manualNtpOff);
    await dialog(page).getByRole('button', { name: MESSAGES.dialog.cancel }).click();
    expect((await timeStatus(mock)).sets).toEqual([]);
    await card(page).getByRole('button', { name: T.manualSet, exact: true }).click();
    await dialog(page).getByRole('button', { name: T.manualConfirm }).click();
    await expect.poll(async () => (await timeStatus(mock)).sets).toHaveLength(1);
    // Europe/Paris in July is UTC+2.
    expect((await timeStatus(mock)).sets[0]).toEqual({ ntp: false, time: '2026-07-01T10:00:00Z' });
    await expect(card(page)).toContainText(T.manual);
});

test('a time the clocks skip is refused before anything is sent', async ({ page, mock }) => {
    await configure(mock, { time: { ntp: false, synchronized: false } });
    await openAdmin(page);
    await manualInput(page).fill('2027-03-28T02:30');
    await card(page).getByRole('button', { name: T.manualSet, exact: true }).click();
    await expect(card(page).locator('.time__problem')).toContainText('Europe/Paris');
    await expect(dialog(page)).toHaveCount(0);
    expect((await timeStatus(mock)).sets).toEqual([]);
});

test('the time zone list filters as one types, and keeps the chosen zone listed', async ({ page }) => {
    await openAdmin(page);
    const zones = card(page).getByLabel(T.timezone, { exact: true });
    await expect(zones.locator('option')).toHaveCount(21);
    await card(page).getByLabel(T.zoneFilter).fill('new york');
    // Europe/Paris is the chosen one: "Apply" would still send it, so it stays.
    await expect(zones.locator('option')).toHaveText(['Europe/Paris', 'America/New_York']);
    await expect(card(page).getByText(T.zoneNone)).toHaveCount(0);
    await card(page).getByLabel(T.zoneFilter).fill('zzz');
    await expect(zones.locator('option')).toHaveText(['Europe/Paris']);
    await expect(zones).toHaveValue('Europe/Paris');
    await expect(card(page).getByText(T.zoneNone)).toBeVisible();
});

test('a box zone this browser does not know: said on the page, no time sent', async ({ page, mock }) => {
    await configure(mock, { time: { ntp: false, synchronized: false, timezone: 'Mars/Olympus_Mons' } });
    await openAdmin(page);
    const problem = fill(T.manualProblem.zone, { zone: 'Mars/Olympus_Mons' });
    await expect(card(page).locator('.time__problem')).toHaveText(problem);
    await expect(manualInput(page)).toHaveValue('');
    await manualInput(page).fill('2026-07-01T12:00');
    await card(page).getByRole('button', { name: T.manualSet, exact: true }).click();
    await expect(card(page).locator('.time__problem')).toHaveText(problem);
    await expect(dialog(page)).toHaveCount(0);
    expect((await timeStatus(mock)).sets).toEqual([]);
});

test('"Set" waits for an edit, and a message goes when one types again', async ({ page, mock }) => {
    await configure(mock, { time: { ntp: false, synchronized: false } });
    await openAdmin(page);
    const set = card(page).getByRole('button', { name: T.manualSet, exact: true });
    await expect(set).toBeDisabled();
    await manualInput(page).fill('2027-03-28T02:30');
    await set.click();
    await expect(card(page).locator('.time__problem')).toBeVisible();
    await manualInput(page).fill('2027-03-28T03:30');
    await expect(card(page).locator('.time__problem')).toHaveCount(0);
});

test('a 520 px window: "Set" stays in view and the typed value shows in full', async ({ page, mock }) => {
    await page.setViewportSize({ width: 520, height: 900 });
    await configure(mock, { time: { ntp: false, synchronized: false } });
    await openAdmin(page);
    await manualInput(page).fill('2027-01-15T08:30:45');
    const set = card(page).getByRole('button', { name: T.manualSet, exact: true });
    await expect(set).toBeInViewport({ ratio: 1 });
    const clipped = await manualInput(page).evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(clipped).toBe(false);
});

test('"Stop using NTP" sends ntp:false alone', async ({ page, mock }) => {
    await openAdmin(page);
    await card(page).getByRole('button', { name: T.stopNtp }).click();
    await expect.poll(async () => (await timeStatus(mock)).sets).toEqual([{ ntp: false }]);
    await expect(card(page)).toContainText(T.manual);
});
