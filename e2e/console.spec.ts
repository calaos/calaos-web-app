// The web console against the mock's echo console: a code to the approver
// phone, typed back, then xterm on /api/console. Also: a wrong code, no
// approver, the refusals of the open message, the closes the clock tells
// apart, a refused upgrade, and xterm.js staying out of every other page.

import { LOGIN_URL, MESSAGES, MOCK_PHONES, adminScreen, expect, loginAs, test } from './fixtures';
import type { MockControl } from './fixtures';
import type { Page } from '@playwright/test';

const ADMIN_PASSWORD = 'correct horse battery';
const t = MESSAGES.admin;
const XTERM_CHUNK = /\/assets\/xterm-[^/]+\.js$/;

function fill(text: string, values: Record<string, string | number>): string {
    return text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key]));
}

/** Requests for the xterm.js chunk, from now on. */
function watchXterm(page: Page): string[] {
    const hits: string[] = [];
    page.on('request', (request) => {
        if (XTERM_CHUNK.test(new URL(request.url()).pathname)) hits.push(request.url());
    });
    return hits;
}

async function openAdmin(page: Page): Promise<void> {
    await page.goto('/');
    await loginAs(page);
    const admin = adminScreen(page);
    await admin.tab.click();
    await admin.adminPassword.fill(ADMIN_PASSWORD);
    await admin.submit.click();
    await expect(admin.updates).toBeVisible();
}

async function openConsole(page: Page): Promise<void> {
    await page.locator('.actions__row', { hasText: t.actions.console }).getByRole('button', { name: t.actions.consoleOpen }).click();
    await expect(page).toHaveURL(/#\/admin\/console$/);
}

const codeField = (page: Page) => page.getByLabel(t.code.label);
const terminal = (page: Page) => page.locator('.console__terminal .xterm-rows');

test.beforeEach(async ({ mock }) => {
    await mock.reset();
    await mock.admin({ password: ADMIN_PASSWORD, codeIntervalMs: 1_000, approvers: [MOCK_PHONES.pixel.tokenId] });
});

test('open, type, echo, close: and xterm.js is only fetched for the console', async ({ page, mock }) => {
    const xterm = watchXterm(page);
    await openAdmin(page);
    expect(xterm).toEqual([]);

    await openConsole(page);
    await expect(page.getByText(t.code.console.title)).toBeVisible();
    await expect(page.getByText(fill(t.code.console.hint, { phone: MOCK_PHONES.pixel.name }))).toBeVisible();
    const pushed = await mock.lastCode();
    expect(pushed).toMatchObject({ action: 'console_open', token_id: MOCK_PHONES.pixel.tokenId });
    await codeField(page).fill(pushed.code);

    await expect(terminal(page)).toContainText('root@calaos:~#');
    expect(xterm).toHaveLength(1);
    await expect(page.locator('.console__status')).toContainText(fill(t.console.endsIn, { minutes: 60 }));

    await page.locator('.console__terminal .xterm-helper-textarea').focus();
    await page.keyboard.type('echo hello');
    await page.keyboard.press('Enter');
    await expect(terminal(page)).toContainText('echo hello');

    const seen = await mock.console();
    expect(seen.open).toBe(1);
    // Nothing secret in the URL: the session and the code id travel in the first message.
    expect(seen.connections).toHaveLength(1);
    expect(seen.connections[0]).toMatchObject({ url: '/api/console', protocol: 'calaos-console.v1', ready: true });
    expect(seen.connections[0].openKeys).toEqual(
        ['admin_session', 'cn_pass', 'cn_user', 'code_id', 'columns', 'rows', 'term', 'type'],
    );
    expect(seen.received.filter((m) => m.type === 'input').map((m) => (m as { data: string }).data).join('')).toBe(
        'echo hello\r',
    );
    expect(seen.received.every((m) => m.type !== 'resize' || (m.columns >= 1 && m.columns <= 1000))).toBe(true);

    // The box ends it: the shell exited.
    await mock.console({ close: 1000 });
    await expect(page.getByRole('alert')).toContainText(t.console.end.exited);
    await expect(page.getByRole('button', { name: t.console.again })).toBeVisible();
});

test('leaving the page closes the console', async ({ page, mock }) => {
    await openAdmin(page);
    await openConsole(page);
    await codeField(page).fill((await mock.lastCode()).code);
    await expect(terminal(page)).toContainText('root@calaos:~#');
    expect((await mock.console()).open).toBe(1);

    await adminScreen(page).tab.click();
    await expect(page).toHaveURL(/#\/admin$/);
    await expect.poll(async () => (await mock.console()).open).toBe(0);
});

test('a closure by the box that is neither the hour nor idleness says so', async ({ page, mock }) => {
    await openAdmin(page);
    await openConsole(page);
    await codeField(page).fill((await mock.lastCode()).code);
    await expect(terminal(page)).toContainText('root@calaos:~#');

    await mock.console({ close: 1001 });
    await expect(page.getByRole('alert')).toContainText(t.console.end.server);
});

test('a wrong code: the attempts left, and the right one still opens', async ({ page, mock }) => {
    await openAdmin(page);
    await openConsole(page);
    const pushed = await mock.lastCode();
    const wrong = String((Number(pushed.code) + 1) % 1_000_000).padStart(6, '0');

    await codeField(page).fill(wrong);
    await expect(page.getByRole('alert')).toContainText('Wrong code. 4 attempts left.');
    expect((await mock.console()).connections).toHaveLength(0);

    await codeField(page).fill(pushed.code);
    await expect(terminal(page)).toContainText('root@calaos:~#');
});

test('no approver phone: no code is asked for, the enrolment is one tap away', async ({ page, mock }) => {
    await mock.admin({ approvers: [] });
    await openAdmin(page);
    await openConsole(page);
    await expect(page.getByText(t.console.noApprover.title)).toBeVisible();
    expect((await mock.adminStatus()).pushed).toEqual([]);

    await page.getByRole('button', { name: t.approvers.add }).click();
    await expect(page).toHaveURL(/#\/admin$/);
    await expect(page.getByRole('dialog')).toBeVisible();
});

test('a refused upgrade over http asks for https', async ({ page, mock }) => {
    await mock.console({ refuseUpgrade: true });
    await openAdmin(page);
    await openConsole(page);
    await codeField(page).fill((await mock.lastCode()).code);
    await expect(page.getByRole('alert')).toContainText(t.console.end.https);
    await expect(page.getByRole('link', { name: t.notice.httpsOpen })).toHaveAttribute('href', /^https:\/\//);
});

async function typeCode(page: Page, mock: MockControl): Promise<void> {
    await codeField(page).fill((await mock.lastCode()).code);
}

test('a used or late grant: the console asks for a new code', async ({ page, mock }) => {
    await mock.console({ refuseWith: { error: 'code_expired' } });
    // A new code right away: no wait between two codes here.
    await mock.admin({ codeIntervalMs: 0 });
    await openAdmin(page);
    await openConsole(page);
    await typeCode(page, mock);
    await expect(page.getByRole('alert')).toContainText(t.console.end.codeExpired);

    await page.getByRole('button', { name: t.console.again }).click();
    await expect(codeField(page)).toBeVisible();
    await expect.poll(async () => (await mock.adminStatus()).pushed.length).toBe(2);
});

test('an admin session refused by the box goes back to the admin password', async ({ page, mock }) => {
    await mock.console({ refuseWith: { error: 'bad_session' } });
    await openAdmin(page);
    await openConsole(page);
    await typeCode(page, mock);
    await expect(page).toHaveURL(/#\/admin$/);
    await expect(adminScreen(page).adminPassword).toBeVisible();
});

test('household credentials refused by the console: sign in again', async ({ page, mock }) => {
    await openAdmin(page);
    await openConsole(page);
    // The household password changed elsewhere while this tab kept its socket.
    await mock.credentials('demo', 'changed elsewhere');
    await typeCode(page, mock);
    await expect(page.getByRole('alert')).toContainText(t.error.login_failed);
    await page.getByRole('button', { name: t.console.signIn }).click();
    await expect(page).toHaveURL(LOGIN_URL);
});

test('too many consoles: the limit comes from the box', async ({ page, mock }) => {
    await mock.console({ refuseWith: { error: 'console_limit', max: '2' } });
    await openAdmin(page);
    await openConsole(page);
    await typeCode(page, mock);
    await expect(page.getByRole('alert')).toContainText(fill(t.error.console_limit, { max: 2 }));
});

test('the console lifetime runs out', async ({ page, mock }) => {
    await mock.console({ expiresIn: 2 });
    await openAdmin(page);
    await openConsole(page);
    await typeCode(page, mock);
    await expect(terminal(page)).toContainText('root@calaos:~#');
    await page.waitForTimeout(2_000);
    await mock.console({ close: 1001 });
    await expect(page.getByRole('alert')).toContainText(fill(t.console.end.expired, { minutes: 1 }));
});

test('the console closes after the idle delay', async ({ page, mock }) => {
    await mock.console({ idleTimeout: 2 });
    await openAdmin(page);
    await openConsole(page);
    await typeCode(page, mock);
    await expect(terminal(page)).toContainText('root@calaos:~#');
    await expect(page.locator('.console__status')).toContainText(fill(t.console.idleSoon, { seconds: 2 }).split(':')[0]);
    await page.waitForTimeout(2_000);
    await mock.console({ close: 1001 });
    await expect(page.getByRole('alert')).toContainText(fill(t.console.end.idle, { minutes: 1 }));
});

async function openedConsole(page: Page, mock: MockControl): Promise<void> {
    await openAdmin(page);
    await openConsole(page);
    await typeCode(page, mock);
    await expect(terminal(page)).toContainText('root@calaos:~#');
}

test('the close reason tells the hour: no clock guess', async ({ page, mock }) => {
    await openedConsole(page, mock);
    await mock.console({ close: 1001, reason: 'expired' });
    await expect(page.getByRole('alert')).toContainText(fill(t.console.end.expired, { minutes: 60 }));
});

test('the close reason tells idleness at once', async ({ page, mock }) => {
    await openedConsole(page, mock);
    await mock.console({ close: 1001, reason: 'idle' });
    await expect(page.getByRole('alert')).toContainText(fill(t.console.end.idle, { minutes: 15 }));
});

test('admin_set: the end is explained and a new console asks for the admin password', async ({ page, mock }) => {
    await openedConsole(page, mock);
    await mock.console({ close: 1001, reason: 'admin_set' });
    await expect(page.getByRole('alert')).toContainText(t.console.end.admin_set);
    await page.getByRole('button', { name: t.console.again }).click();
    await expect(page).toHaveURL(/#\/admin$/);
    await expect(adminScreen(page).adminPassword).toBeVisible();
});

test('an unknown close reason keeps the generic message', async ({ page, mock }) => {
    await openedConsole(page, mock);
    await mock.console({ close: 1001, reason: 'from_the_future' });
    await expect(page.getByRole('alert')).toContainText(t.console.end.server);
});
