// The web console against the mock's echo console: a code to the approver
// phone, typed back, then xterm on /api/console. Also: a wrong code, no
// approver, a refused upgrade, and xterm.js staying out of every other page.

import { MESSAGES, MOCK_PHONES, adminScreen, expect, loginAs, test } from './fixtures';
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
