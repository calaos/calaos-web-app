// The logs page against the mock's synthetic journal: filters, "load older"
// by cursor, complete:false and truncated, follow by polling (stopped when
// the page goes or the tab hides), the rate_limited back-off, the download.

import { readFile } from 'node:fs/promises';
import L from '../app/src/i18n/admin/logs.en.json';
import { MESSAGES, adminScreen, expect, loginAs, test } from './fixtures';
import type { MockControl } from './fixtures';
import type { Page } from '@playwright/test';

const ADMIN_PASSWORD = 'correct horse battery';

interface LogsStatus {
    size: number;
    queries: number;
    lastQuery: Record<string, unknown> | null;
}

async function logsStatus(mock: MockControl): Promise<LogsStatus> {
    return (await mock.send<{ logs: LogsStatus }>({ op: 'admin_status' })).logs;
}

async function configureLogs(mock: MockControl, logs: Record<string, unknown>): Promise<void> {
    const op = { op: 'admin' as const, logs };
    await mock.send(op);
}

async function openLogs(page: Page): Promise<void> {
    await page.goto('/');
    await loginAs(page);
    const admin = adminScreen(page);
    await admin.tab.click();
    await admin.adminPassword.fill(ADMIN_PASSWORD);
    await admin.submit.click();
    await expect(admin.hub).toBeVisible();
    await page.locator('[data-page="logs"]').click();
    await expect(page).toHaveURL(/#\/admin\/logs$/);
    // Narrow screens fold the filters away; wide ones show them beside the journal.
    const toggle = page.locator('.logs__filters-toggle');
    if (await toggle.isVisible()) {
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    }
}

const rows = (page: Page) => page.locator('.log-row');
const chip = (page: Page, name: string) => page.locator('.logs__chip', { hasText: name });
const followButton = (page: Page) => page.locator('.logs__follow');
const count = (n: number) => `${n} lines`;

test.beforeEach(async ({ mock }) => {
    await mock.reset();
    await mock.admin({ password: ADMIN_PASSWORD });
});

test('reads the newest lines of the whole system, masked, and filters by source, level and text', async ({ page, mock }) => {
    await openLogs(page);
    await expect(rows(page)).toHaveCount(200);
    await expect(page.locator('.logs__count')).toHaveText(count(200));
    await expect(page.getByText(L.masked)).toBeVisible();
    const first = await logsStatus(mock);
    expect(first.lastQuery).toMatchObject({ sources: ['system'], priority: 'info', direction: 'backward' });
    expect(typeof first.lastQuery?.since).toBe('string');
    expect(first.lastQuery).not.toHaveProperty('cursor');

    await chip(page, L.source.kernel).click();
    await expect(chip(page, L.source.kernel)).toHaveAttribute('aria-pressed', 'true');
    await expect(chip(page, L.source.system)).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await logsStatus(mock)).lastQuery?.sources).toEqual(['kernel']);
    await expect(rows(page).first()).toBeVisible();
    for (const source of await page.locator('.log-row__source').allTextContents()) expect(source).toBe(L.source.kernel);

    await page.locator('.logs__select').selectOption('err');
    await expect.poll(async () => (await logsStatus(mock)).lastQuery).toMatchObject({ sources: ['kernel'], priority: 'err' });
    // The kernel's only line at err or worse is the EXT4 I/O error (crit).
    await expect(rows(page).first()).toContainText('EXT4-fs warning');
    await expect(rows(page).first()).toHaveClass(/log-row--danger/);

    await chip(page, L.source.system).click();
    await page.locator('.logs__select').selectOption('debug');
    await page.getByPlaceholder(L.searchPlaceholder).fill('cn_pass=***');
    await expect.poll(async () => (await logsStatus(mock)).lastQuery).toMatchObject({ sources: ['system'], text: 'cn_pass=***' });
    await expect(rows(page).first()).toContainText('cn_pass=***');
    for (const message of await page.locator('.log-row__message').allTextContents()) expect(message).toContain('cn_pass=***');
    // Each filter change is a new search: never a cursor from the previous one.
    expect((await logsStatus(mock)).lastQuery).not.toHaveProperty('cursor');
});

test('loads older pages by cursor, and says when the scan or the budget stopped short', async ({ page, mock }) => {
    await openLogs(page);
    await expect(rows(page)).toHaveCount(200);
    const newestFirstPage = await rows(page).first().locator('time').getAttribute('datetime');

    await page.getByRole('button', { name: L.loadOlder }).click();
    await expect(rows(page)).toHaveCount(400);
    const query = (await logsStatus(mock)).lastQuery;
    expect(query).toMatchObject({ direction: 'backward', sources: ['system'] });
    expect(typeof query?.cursor).toBe('string');
    expect(query).not.toHaveProperty('until');
    const oldest = await rows(page).first().locator('time').getAttribute('datetime');
    expect(Date.parse(oldest ?? '')).toBeLessThan(Date.parse(newestFirstPage ?? ''));

    await configureLogs(mock, { truncateNext: true });
    await page.getByRole('button', { name: L.loadOlder }).click();
    await expect(rows(page)).toHaveCount(500);
    await expect(page.getByText(L.truncated)).toBeVisible();

    // Envoy writes rarely: 5000 entries scanned hold fewer than 200 of its lines.
    await page.getByRole('radio', { name: L.range.days7 }).click();
    await chip(page, L.source.envoy).click();
    await expect(page.getByText(L.incomplete)).toBeVisible();
    const scanned = await rows(page).count();
    expect(scanned).toBeLessThan(200);
    await page.getByRole('button', { name: L.loadOlder }).click();
    await expect.poll(() => rows(page).count()).toBeGreaterThan(scanned);
});

test('follows by polling forward from the last cursor, and stops on leaving or hiding the tab', async ({ page, mock }) => {
    test.setTimeout(60_000);
    await openLogs(page);
    await expect(rows(page)).toHaveCount(200);
    const lastCursorRow = await rows(page).last().locator('time').getAttribute('datetime');

    await followButton(page).click();
    await expect(followButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.logs__live')).toHaveText(L.live);
    await expect.poll(async () => (await logsStatus(mock)).lastQuery?.direction).toBe('forward');
    const forward = (await logsStatus(mock)).lastQuery;
    expect(forward).toMatchObject({ sources: ['system'], priority: 'info' });
    expect(forward).not.toHaveProperty('since');
    expect(typeof forward?.cursor).toBe('string');
    // The mock writes 1 to 3 lines a second: new rows land at the bottom.
    await expect.poll(() => rows(page).count(), { timeout: 8_000 }).toBeGreaterThan(200);
    const newest = await rows(page).last().locator('time').getAttribute('datetime');
    expect(Date.parse(newest ?? '')).toBeGreaterThan(Date.parse(lastCursorRow ?? ''));

    // A hidden tab stops polling; showing it again resumes from the same cursor.
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.locator('.logs__live')).toHaveText(L.paused);
    const hiddenAt = (await logsStatus(mock)).queries;
    await page.waitForTimeout(4_500);
    expect((await logsStatus(mock)).queries).toBe(hiddenAt);
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.locator('.logs__live')).toHaveText(L.live);
    await expect.poll(async () => (await logsStatus(mock)).queries).toBeGreaterThan(hiddenAt);

    // Leaving the page ends the follow.
    await page.goBack();
    await expect(page).toHaveURL(/#\/admin$/);
    const leftAt = (await logsStatus(mock)).queries;
    await page.waitForTimeout(4_500);
    expect((await logsStatus(mock)).queries).toBe(leftAt);
});

test('backs off while the box answers rate_limited, then follows again', async ({ page, mock }) => {
    test.setTimeout(45_000);
    await openLogs(page);
    await expect(rows(page)).toHaveCount(200);
    await configureLogs(mock, { rateLimitNext: 2 });
    const before = (await logsStatus(mock)).queries;
    await followButton(page).click();
    // Two refusals: 2 s, then 4 s before the next read.
    await expect(page.locator('.logs__live')).toHaveText(L.slowedDown.replace('{seconds}', '2'));
    await expect(page.locator('.logs__live')).toHaveText(L.slowedDown.replace('{seconds}', '4'), { timeout: 4_000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.logs__live')).toHaveText(L.live, { timeout: 8_000 });
    // Refused queries are not counted by the mock: one answered read so far.
    await expect.poll(async () => (await logsStatus(mock)).queries).toBeGreaterThan(before);
    await expect.poll(() => rows(page).count(), { timeout: 8_000 }).toBeGreaterThan(200);
});

test('downloads the lines on screen as text', async ({ page }) => {
    await openLogs(page);
    await chip(page, L.source['calaos-server']).click();
    await expect(page.locator('.logs__count')).toHaveText(count(200));
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: L.download }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^calaos-logs-\d{8}-\d{4}\.txt$/);
    const path = await download.path();
    const text = await readFile(path, 'utf8');
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(200);
    for (const line of lines) expect(line).toMatch(/^\d{4}-\d\d-\d\dT\S+Z calaos-server\[\d+\] (err|warning|info): /);
});

test('an older daemon: the logs page says to update the box, and stays open', async ({ page, mock }) => {
    await mock.admin({ tooOld: ['logs_sources', 'logs_query'] });
    await openLogs(page);
    await expect(page.locator('.logs__error')).toContainText(MESSAGES.admin.error.daemon_too_old);
    await page.waitForTimeout(6_000);
    await expect(page).toHaveURL(/#\/admin\/logs$/);
    await expect(page.locator('.logs__error')).toBeVisible();
});
