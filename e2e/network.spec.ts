// The network page against the mock's fake daemon: a static change applied
// with a phone code and kept, one left to roll back (and the banner that
// says so), the box moving under the page (the reply sent then the socket
// cut, or the socket cut first), a reload during the trial, a wrong code,
// a change already waiting, and a countdown that ignores the browser clock.

import { MESSAGES, MOCK_PHONES, adminScreen, expect, loginAs, test } from './fixtures';
import type { ControlOp, MockControl } from './fixtures';
import type { Page } from '@playwright/test';
import { createConnection, createServer } from 'node:net';
import type { AddressInfo, Server, Socket } from 'node:net';
import net from '../app/src/i18n/admin/network.en.json';

const ADMIN_PASSWORD = 'correct horse battery';
const t = MESSAGES.admin;
const NEW_ADDRESS = '192.168.1.20/24';
const REOPEN_URL = 'http://192.168.1.20:4173/#/admin/network';

/** `/control {op:'admin', network}` (mock-server/admin-network.mjs `configure`). */
interface NetworkPatch {
    confirmMs?: number;
    dropOnApply?: boolean | 'before';
    hangOnApply?: boolean;
    hangOnConfirm?: boolean;
    tooOld?: boolean;
    unknownOutcome?: boolean | 'unapplied';
    ipv4?: Record<string, string>;
    expire?: boolean;
    pending?: { intf?: string; ageMs?: number };
}

interface NetworkStatus {
    pending: { change_id: string; intf: string; expires_in: number } | null;
    history: { kind: string; intf: string }[];
}

function fill(text: string, values: Record<string, string | number>): string {
    return text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key]));
}

async function network(mock: MockControl, patch: NetworkPatch): Promise<void> {
    await mock.send({ op: 'admin', network: patch } as ControlOp);
}

async function networkStatus(mock: MockControl): Promise<NetworkStatus> {
    return (await mock.send<{ network: NetworkStatus }>({ op: 'admin_status' })).network;
}

async function unlock(page: Page): Promise<void> {
    const admin = adminScreen(page);
    await admin.tab.click();
    await admin.adminPassword.fill(ADMIN_PASSWORD);
    await admin.submit.click();
    await expect(admin.hub).toBeVisible();
}

async function openNetwork(page: Page, url = '/'): Promise<void> {
    await page.goto(url);
    await loginAs(page);
    await unlock(page);
    await page.locator('[data-page="network"]').click();
    await expect(page).toHaveURL(/#\/admin\/network$/);
    await expect(row(page, 'eth0')).toContainText(/\d+\.\d+\.\d+\.\d+\/\d+/);
}

const row = (page: Page, name: string) => page.locator('.network__intf').filter({ has: page.getByRole('heading', { name, exact: true }) });
const panel = (page: Page) => page.locator('.net-pending');
const clock = (page: Page) => page.getByRole('timer');
const codeField = (page: Page) => page.getByRole('dialog').getByLabel(t.code.label);

/** Edits eth0 to the new static address and walks through the warning to the code. */
async function proposeStatic(page: Page): Promise<void> {
    await row(page, 'eth0').getByRole('button', { name: `${net.edit} eth0` }).click();
    await page.getByLabel(net.form.address).fill(NEW_ADDRESS);
    await page.getByRole('button', { name: net.form.apply }).click();
    const warning = page.getByRole('dialog', { name: net.warn.title });
    await expect(warning).toContainText(net.warn.hint);
    await warning.getByRole('button', { name: net.warn.confirm }).click();
    await expect(codeField(page)).toBeVisible();
}

async function typeCode(page: Page, mock: MockControl): Promise<void> {
    const pushed = await mock.lastCode();
    expect(pushed).toMatchObject({ action: 'network_config', token_id: MOCK_PHONES.pixel.tokenId });
    await codeField(page).fill(pushed.code);
}

/** The preview server, on whichever loopback it listens (Node may pick ::1 for `localhost`). */
function connectPreview(port: number): Promise<Socket> {
    const attempt = (host: string) =>
        new Promise<Socket>((resolve, reject) => {
            const socket = createConnection({ host, port });
            socket.once('connect', () => resolve(socket));
            socket.once('error', reject);
        });
    return attempt('::1').catch(() => attempt('127.0.0.1'));
}

/** 127.0.0.1:<random> → the preview server. */
async function ipv4Relay(targetPort: string): Promise<{ server: Server; close: () => void }> {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
        sockets.add(socket);
        socket.pause();
        socket.on('error', () => socket.destroy());
        connectPreview(Number(targetPort)).then(
            (upstream) => {
                sockets.add(upstream);
                upstream.on('error', () => socket.destroy());
                socket.pipe(upstream).pipe(socket);
                socket.resume();
            },
            () => socket.destroy(),
        );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
        server,
        close: () => {
            for (const socket of sockets) socket.destroy();
            server.close();
        },
    };
}

/** m:ss → seconds. */
async function secondsShown(page: Page): Promise<number> {
    const [m, s] = (await clock(page).innerText()).split(':').map(Number);
    return m * 60 + s;
}

test.beforeEach(async ({ mock }) => {
    await mock.reset();
    await mock.admin({ password: ADMIN_PASSWORD, codeIntervalMs: 1_000, approvers: [MOCK_PHONES.pixel.tokenId] });
});

test('apply a static address with the phone code, then keep it', async ({ page, mock }) => {
    await openNetwork(page);
    await expect(row(page, 'eth1')).toContainText(net.state.noCarrier);
    await expect(page.locator('.network__intf')).toHaveCount(2);

    await proposeStatic(page);
    await typeCode(page, mock);

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(panel(page)).toContainText(fill(net.pending.title, { intf: 'eth0' }));
    expect(await secondsShown(page)).toBeGreaterThan(110);
    expect(await secondsShown(page)).toBeLessThanOrEqual(120);
    // Where to go if the box moves, shown before it does.
    await expect(panel(page).getByRole('link', { name: REOPEN_URL })).toHaveAttribute('href', REOPEN_URL);
    await expect(row(page, 'eth0').getByRole('button', { name: `${net.edit} eth0` })).toBeDisabled();

    await panel(page).getByRole('button', { name: net.pending.confirm }).click();
    await expect(page.getByRole('status').filter({ hasText: fill(net.done.confirmed, { intf: 'eth0' }) })).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    await expect(row(page, 'eth0')).toContainText(NEW_ADDRESS);
    expect((await networkStatus(mock)).history.map((entry) => entry.kind)).toEqual(['applied', 'confirmed']);
});

test('the form refuses what the box would, before any code is asked', async ({ page, mock }) => {
    await openNetwork(page);
    await row(page, 'eth0').getByRole('button', { name: `${net.edit} eth0` }).click();
    await page.getByLabel(net.form.address).fill('192.168.1.20');
    await page.getByLabel(net.form.gateway).fill('192.168.1.256');
    await page.getByRole('button', { name: net.form.apply }).click();
    await expect(page.getByText(net.form.error.ipv4)).toBeVisible();
    await expect(page.getByText(net.form.error.gateway)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await mock.adminActions()).not.toContain('code_request');
});

test('not kept in time: the box rolls back, and the banner says so', async ({ page, mock }) => {
    await network(mock, { confirmMs: 2_500 });
    await openNetwork(page);
    await proposeStatic(page);
    await typeCode(page, mock);
    await expect(panel(page)).toBeVisible();

    const banner = page.getByRole('alert', { name: t.alerts.label });
    await expect(banner).toContainText(fill(net.alert.title, { intf: 'eth0' }), { timeout: 10_000 });
    await expect(banner).toContainText(net.alert.hint);
    await expect(panel(page)).toHaveCount(0);
    await expect(row(page, 'eth0')).toContainText('192.168.1.10/24');

    // Stored by the box: the next sign-in shows it again until it is acknowledged.
    await page.reload();
    await loginAs(page);
    await expect(banner).toContainText(fill(net.alert.title, { intf: 'eth0' }));
    await banner.getByRole('button', { name: t.alerts.dismiss }).click();
    await expect(banner).toHaveCount(0);
});

test('the box moves after answering: the page says where to reopen it', async ({ page, context, mock }) => {
    await network(mock, { dropOnApply: true });
    await openNetwork(page);
    await proposeStatic(page);
    await typeCode(page, mock);
    await expect(panel(page)).toBeVisible();
    // Keep the page cut off, as it would be from a box at a new address.
    await context.setOffline(true);

    const lost = panel(page).getByRole('alert');
    await expect(lost).toContainText(net.pending.lost);
    await expect(lost.getByRole('link', { name: REOPEN_URL })).toBeVisible();
    await expect(panel(page).getByRole('button', { name: net.pending.confirm })).toBeDisabled();

    // Back in reach: same session, the change still waiting, and it can be kept.
    await context.setOffline(false);
    await expect(lost).toHaveCount(0, { timeout: 15_000 });
    await expect(panel(page).getByRole('button', { name: net.pending.confirm })).toBeEnabled();
    await panel(page).getByRole('button', { name: net.pending.confirm }).click();
    await expect(page.getByRole('status').filter({ hasText: fill(net.done.confirmed, { intf: 'eth0' }) })).toBeVisible();
});

test('the box moves before answering: no error, and the change is found again', async ({ page, mock }) => {
    await network(mock, { dropOnApply: 'before' });
    await openNetwork(page);
    await proposeStatic(page);
    await typeCode(page, mock);

    // The code entry closes with nothing to report.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.network__refusal')).toHaveCount(0);
    // The reconnect reads network_state, which still knows the change; this
    // page made it, so it still knows the address to reopen.
    await expect(panel(page)).toContainText(fill(net.pending.title, { intf: 'eth0' }), { timeout: 15_000 });
    await expect(panel(page).getByRole('link', { name: REOPEN_URL })).toBeVisible();
    await expect(panel(page).getByRole('button', { name: net.pending.confirm })).toBeEnabled();
    expect((await networkStatus(mock)).pending?.intf).toBe('eth0');

    await panel(page).getByRole('button', { name: net.pending.revert }).click();
    await expect(page.getByRole('status').filter({ hasText: fill(net.done.reverted, { intf: 'eth0' }) })).toBeVisible();
    expect((await networkStatus(mock)).history.map((entry) => entry.kind)).toEqual(['applied', 'reverted']);
});

test('a reload during the trial finds the countdown again after unlocking', async ({ page, mock }) => {
    await openNetwork(page);
    await proposeStatic(page);
    await typeCode(page, mock);
    await expect(panel(page)).toBeVisible();

    // Sign-in and admin session lived in memory: both are asked again.
    await page.reload();
    await loginAs(page);
    await unlock(page);

    const entry = page.locator('[data-page="network"]');
    await expect(entry).toContainText(fill(net.entry.pending, { intf: 'eth0', time: '@' }).split('@')[0]);
    await entry.click();
    await expect(panel(page)).toContainText(fill(net.pending.title, { intf: 'eth0' }));
    // The box's own count, not a fresh 2:00 from the reload.
    const boxLeft = (await networkStatus(mock)).pending?.expires_in ?? 0;
    expect(Math.abs((await secondsShown(page)) - boxLeft)).toBeLessThanOrEqual(2);
    await panel(page).getByRole('button', { name: net.pending.confirm }).click();
    await expect(page.getByRole('status').filter({ hasText: fill(net.done.confirmed, { intf: 'eth0' }) })).toBeVisible();
});

test('a wrong code is said in the code entry, and the right one still applies', async ({ page, mock }) => {
    await openNetwork(page);
    await proposeStatic(page);
    const pushed = await mock.lastCode();
    await codeField(page).fill(pushed.code === '000000' ? '111111' : '000000');
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Wrong code.');
    await expect(panel(page)).toHaveCount(0);
    expect((await networkStatus(mock)).pending).toBeNull();

    await codeField(page).fill(pushed.code);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(panel(page)).toBeVisible();
});

test('a change already waiting on the box: the refusal, then that change', async ({ page, mock }) => {
    await openNetwork(page);
    await proposeStatic(page);
    // Applied from elsewhere while this page was typing.
    await network(mock, { pending: { intf: 'eth1', ageMs: 30_000 } });
    await typeCode(page, mock);

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.network__refusal')).toHaveText(t.error.network_pending);
    await expect(panel(page)).toContainText(fill(net.pending.title, { intf: 'eth1' }));
    // Not this page's change: no address to send anyone to.
    await expect(panel(page).getByRole('link')).toHaveCount(0);
});

test('the countdown is the box’s, even with the browser clock an hour off', async ({ page, mock }) => {
    await page.clock.install({ time: Date.now() + 3_600_000 });
    await network(mock, { pending: { intf: 'eth0', ageMs: 90_000 } });
    await openNetwork(page);
    const seconds = await secondsShown(page);
    expect(seconds).toBeGreaterThan(20);
    expect(seconds).toBeLessThanOrEqual(30);
});

test('an older daemon: the network row says so, and the Admin page stays unlocked', async ({ page, mock }) => {
    await network(mock, { tooOld: true });
    await page.goto('/');
    await loginAs(page);
    await unlock(page);
    const entry = page.locator('[data-page="network"]');
    await expect(entry).toContainText(t.error.daemon_too_old);
    // Nothing flips the page to "being activated" and back.
    await page.waitForTimeout(7_000);
    await expect(adminScreen(page).hub).toBeVisible();
    await expect(adminScreen(page).adminPassword).toHaveCount(0);
    expect((await mock.adminActions()).filter((action) => action === 'network_state')).toHaveLength(1);
});

test('the change moves this page’s own address: the new address comes first, a keep from here goes unanswered', async ({
    page,
    mock,
}) => {
    test.setTimeout(60_000);
    // The page is served from eth0's own address, which the change takes away.
    // `vite preview` may listen on ::1 only: a TCP relay gives it an IPv4 face.
    const relay = await ipv4Relay(new URL(test.info().project.use.baseURL ?? 'http://localhost:4173').port);
    const port = (relay.server.address() as AddressInfo).port;
    try {
        await network(mock, { ipv4: { eth0: '127.0.0.1/8' }, hangOnApply: true });
        await page.clock.install();
        await openNetwork(page, `http://127.0.0.1:${port}/`);
        await proposeStatic(page);
        await typeCode(page, mock);

        await expect(panel(page)).toContainText(net.pending.moves);
        const open = panel(page).getByRole('link', { name: net.pending.open });
        await expect(open).toHaveAttribute('href', `http://192.168.1.20:${port}/#/admin/network`);
        await expect(panel(page)).toContainText(net.pending.onlyIfAnswers);
        await expect(panel(page).getByRole('button', { name: net.pending.confirm })).toHaveClass(/admin-button--quiet/);

        // The socket stays open and silent, as at an address the box left.
        await panel(page).getByRole('button', { name: net.pending.confirm }).click();
        await page.clock.fastForward(41_000);
        await expect(panel(page).getByRole('alert')).toContainText(net.pending.unanswered);
        await expect(page.getByText(t.error.timeout)).toHaveCount(0);
        expect((await networkStatus(mock)).pending?.intf).toBe('eth0');
    } finally {
        relay.close();
    }
});

test('calaos_server stops waiting (outcome unknown): no error, the state is read back', async ({ page, mock }) => {
    await network(mock, { unknownOutcome: true });
    await openNetwork(page);
    await proposeStatic(page);
    await typeCode(page, mock);

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(panel(page)).toContainText(fill(net.pending.title, { intf: 'eth0' }));
    await panel(page).getByRole('button', { name: net.pending.confirm }).click();
    await expect(page.getByRole('status').filter({ hasText: fill(net.done.confirmed, { intf: 'eth0' }) })).toBeVisible();
    await expect(page.getByText(t.error.daemon_unreachable)).toHaveCount(0);
    await expect(adminScreen(page).adminPassword).toHaveCount(0);
});


test('an apply calaos_server stopped waiting for, that did not take: the box kept its settings', async ({ page, mock }) => {
    await network(mock, { unknownOutcome: 'unapplied' });
    await openNetwork(page);
    await proposeStatic(page);
    await typeCode(page, mock);

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: fill(net.done.not_applied, { intf: 'eth0' }) })).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByText(t.error.daemon_unreachable)).toHaveCount(0);
    expect((await networkStatus(mock)).pending).toBeNull();
});

test('kept while our keep goes unanswered: the box’s word ends the trial', async ({ page, mock }) => {
    test.setTimeout(60_000);
    await network(mock, { hangOnConfirm: true });
    await page.clock.install();
    await openNetwork(page);
    await proposeStatic(page);
    await typeCode(page, mock);
    await expect(panel(page)).toContainText(fill(net.pending.title, { intf: 'eth0' }));

    // `network_applied` arrives, then the socket goes silent before the reply.
    await panel(page).getByRole('button', { name: net.pending.confirm }).click();
    await page.clock.fastForward(41_000);
    await expect(page.getByRole('status').filter({ hasText: fill(net.done.confirmed, { intf: 'eth0' }) })).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByText(net.pending.unanswered)).toHaveCount(0);
});
