// The Admin tab against the built bundle and the mock's fake daemon:
// bootstrap on a fresh box, unlock and a session that survives a reconnect,
// an upgrade cut in the middle by calaos-server's own restart, the old
// calaos_server that never answers, and `admin_unavailable` with its retries.
//
// The timings asserted here are the contract's (calaos_base
// docs/08_http_api.md "Délais"): 5 s before "too old", a retry every 5 s on
// `admin_unavailable`. A spec that waits on them is slow by design; the
// Playwright config already runs the suite serially.

import {
    CREDENTIALS,
    MESSAGES,
    adminScreen,
    appChrome,
    expect,
    loginAs,
    test,
} from './fixtures';

const ADMIN_PASSWORD = 'correct horse battery';

test.beforeEach(async ({ mock }) => {
    await mock.reset();
});

/** Signs in, opens the Admin tab, and unlocks it. The mock has the password set. */
async function openUnlocked(page: Parameters<typeof loginAs>[0]): Promise<ReturnType<typeof adminScreen>> {
    await page.goto('/');
    await loginAs(page);
    const admin = adminScreen(page);
    await admin.tab.click();
    await expect(admin.heading).toHaveText(MESSAGES.admin.unlock.title);
    await admin.adminPassword.fill(ADMIN_PASSWORD);
    await admin.submit.click();
    await expect(admin.updates).toBeVisible();
    return admin;
}

test('a fresh box: household password first, then the admin password, then unlocked', async ({
    page,
    mock,
}) => {
    // Factory account, no admin yet.
    await mock.credentials('user', 'pass');
    await page.goto('/');
    await loginAs(page, { user: 'user', pass: 'pass' });

    const admin = adminScreen(page);
    await admin.tab.click();
    await expect(page).toHaveURL(/#\/admin$/);
    await expect(admin.heading).toHaveText(MESSAGES.admin.household.title);

    // The household form: username kept, a new password typed twice.
    const household = page.locator('.household-form');
    await expect(household.getByLabel(MESSAGES.admin.household.user)).toHaveValue('user');
    await household.getByLabel(MESSAGES.admin.household.password, { exact: true }).fill('maison-secrete');
    await household.getByLabel(MESSAGES.admin.household.confirm).fill('maison-secrete');
    await household.locator('.household-form__submit').click();

    // The server dropped the session and the app logged back in with the new
    // pair, without a trip through /#/login — straight to the admin password.
    await expect(admin.heading).toHaveText(MESSAGES.admin.bootstrap.title);
    await expect(page).toHaveURL(/#\/admin$/);
    expect((await mock.status()).user).toBe('user');
    const logins = await mock.loginFrames();
    expect(logins).toHaveLength(2);
    expect(logins[1].frame?.data).toEqual({ cn_user: 'user', cn_pass: 'maison-secrete' });

    // Too short is caught on submit, before the wire; a matching pair goes through.
    await admin.adminPassword.fill('short');
    await admin.confirmPassword.fill('short');
    await admin.submit.click();
    await expect(admin.error).toContainText(MESSAGES.admin.tooShort.replace('{min}', '10'));
    await expect(admin.heading).toHaveText(MESSAGES.admin.bootstrap.title);
    await admin.adminPassword.fill(ADMIN_PASSWORD);
    await admin.confirmPassword.fill(ADMIN_PASSWORD);
    await admin.submit.click();

    // Set, then unlocked with the same password: no second form.
    await expect(admin.updates).toBeVisible();
    await expect(admin.info).toContainText(MESSAGES.admin.info.password_set);
    expect(await mock.adminStatus()).toMatchObject({ set: true, sessions: 1 });
    await expect.poll(async () => (await mock.frameKinds()).filter((kind) => kind?.startsWith('admin'))).toEqual([
        'admin', // update_status probe → admin_not_set
        'admin_set',
        'admin_unlock',
        'admin', // update_status after unlock
        'admin', // approver_list
    ]);
});

test('unlock: a wrong password is refused, the right one opens the panel, and the session outlives a drop', async ({
    page,
    mock,
}) => {
    await mock.admin({ password: ADMIN_PASSWORD });
    await page.goto('/');
    await loginAs(page);

    const admin = adminScreen(page);
    await admin.tab.click();
    await expect(admin.heading).toHaveText(MESSAGES.admin.unlock.title);

    await admin.adminPassword.fill('nope');
    await admin.submit.click();
    await expect(admin.error).toHaveText(MESSAGES.admin.error.bad_password);
    await expect(admin.submit).toHaveClass(/\bshake\b/);
    await expect(admin.adminPassword).toHaveValue('');

    await admin.adminPassword.fill(ADMIN_PASSWORD);
    await admin.submit.click();
    await expect(admin.updates).toBeVisible();
    await expect(admin.updatesHeadline).toHaveText(MESSAGES.admin.updates.unknown);

    // Checking lists the fake daemon's two packages.
    await page.getByRole('button', { name: MESSAGES.admin.updates.check }).click();
    await expect(admin.updatesHeadline).toHaveText('2 updates available');
    await expect(page.locator('.updates__name')).toHaveText(['calaos-container', 'calaos-server']);

    // --- calaos-server goes away and comes back --------------------------
    const loginsBefore = (await mock.loginFrames()).length;
    expect(await mock.drop()).toBeGreaterThan(0);
    await expect.poll(async () => (await mock.loginFrames()).length, { timeout: 15_000 }).toBe(loginsBefore + 1);

    // Still unlocked: no password asked, the panel is where it was, and the
    // app re-read the update status with the login.
    await expect(admin.updates).toBeVisible();
    await expect(admin.adminPassword).toHaveCount(0);
    await expect(appChrome(page).navBar).toBeVisible();
    const actions = await mock.adminActions();
    expect(actions[actions.length - 1]).toBe('update_status');
    expect((await mock.adminStatus()).sessions).toBe(1);
});

test('an upgrade survives calaos-server restarting in the middle of it', async ({ page, mock }) => {
    await mock.admin({ password: ADMIN_PASSWORD, upgradeMs: 4_000, dropAtPercent: 40, rebootRequired: true });
    const admin = await openUnlocked(page);

    await page.getByRole('button', { name: MESSAGES.admin.updates.check }).click();
    await expect(admin.updatesHeadline).toHaveText('2 updates available');
    await page.getByRole('button', { name: MESSAGES.admin.updates.upgrade }).click();

    await expect(admin.progress).toBeVisible();
    await expect(admin.updatesHeadline).toContainText(MESSAGES.admin.updates.upgrading.split('…')[0]);

    // The mock cuts every socket at 40 %: the app logs back in, keeps its
    // session, asks update_status and carries on showing the progress.
    await expect.poll(async () => (await mock.loginFrames()).length, { timeout: 15_000 }).toBe(2);
    await expect.poll(async () => (await mock.adminActions()).slice(-1)[0], { timeout: 10_000 }).toBe(
        'update_status',
    );
    await expect(admin.adminPassword).toHaveCount(0);

    // …until the end, where the job says a restart is due.
    await expect(admin.updatesHeadline).toHaveText(MESSAGES.admin.updates.doneReboot, { timeout: 15_000 });
    await expect(admin.progress).toBeHidden();
    expect((await mock.adminStatus()).job).toMatchObject({ status: 'done', reboot_required: true });

    // A new check after the run: nothing left.
    await page.getByRole('button', { name: MESSAGES.admin.updates.check }).click();
    await expect(admin.updatesHeadline).toHaveText(MESSAGES.admin.updates.upToDate);
});

test('the end of a run never rewinds the bar and shows the outcome without waiting for the poll', async ({
    page,
    mock,
}) => {
    await mock.admin({ password: ADMIN_PASSWORD, upgradeMs: 1_000, rebootRequired: true });
    const admin = await openUnlocked(page);
    await page.getByRole('button', { name: MESSAGES.admin.updates.check }).click();
    await expect(admin.updatesHeadline).toHaveText('2 updates available');

    await page.evaluate(() => {
        const headline = document.querySelector('.updates__headline');
        const seen: string[] = [];
        (window as unknown as { seenHeadlines: string[] }).seenHeadlines = seen;
        if (headline === null) return;
        new MutationObserver(() => seen.push(headline.textContent ?? '')).observe(headline, {
            childList: true,
            characterData: true,
            subtree: true,
        });
    });
    await page.getByRole('button', { name: MESSAGES.admin.updates.upgrade }).click();

    // The 5 s poll would be too late: the outcome comes from the read sent on idle.
    await expect(admin.updatesHeadline).toHaveText(MESSAGES.admin.updates.doneReboot, { timeout: 4_000 });
    const seen = await page.evaluate(() => (window as unknown as { seenHeadlines: string[] }).seenHeadlines);
    const percents = seen.map((text) => /(\d+) %/.exec(text)?.[1]).filter((p) => p !== undefined).map(Number);
    expect(percents.length).toBeGreaterThan(1);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
});

test('a job that ends while calaos-server is away is read back from the job, not the events', async ({
    page,
    mock,
}) => {
    await mock.admin({ password: ADMIN_PASSWORD, upgradeMs: 1_000, dropAtPercent: 90, rebootRequired: true });
    const admin = await openUnlocked(page);
    await page.getByRole('button', { name: MESSAGES.admin.updates.check }).click();
    await page.getByRole('button', { name: MESSAGES.admin.updates.upgrade }).click();

    // The socket dies at 90 % and the run finishes before the reconnect: no
    // terminal event ever reaches the app, and the status it reads back says
    // `idle` — the job alone says how it ended.
    await expect(admin.updatesHeadline).toHaveText(MESSAGES.admin.updates.doneReboot, { timeout: 15_000 });
    expect((await mock.adminStatus()).progress.status).toBe('idle');
    expect((await mock.loginFrames()).length).toBe(2);
});

test('bad_session asks for the password again, silently, and replays only the read', async ({ page, mock }) => {
    await mock.admin({ password: ADMIN_PASSWORD });
    const admin = await openUnlocked(page);

    // The daemon forgets every session (expiry, admin_reset…).
    await mock.admin({ clearSessions: true });
    await page.getByRole('button', { name: MESSAGES.admin.updates.check }).click();

    await expect(admin.heading).toHaveText(MESSAGES.admin.unlock.title);
    await expect(admin.error).toHaveText('');
    await admin.adminPassword.fill(ADMIN_PASSWORD);
    await admin.submit.click();

    // The refused check is finished for the user, with no extra tap.
    await expect(admin.updatesHeadline).toHaveText('2 updates available');
    const actions = await mock.adminActions();
    expect(actions.filter((action) => action === 'update_check')).toHaveLength(2);
    expect(actions).not.toContain('update_upgrade_all');
});

test('package names need the session: shown unlocked, gone once the session expires mid-upgrade', async ({
    page,
    mock,
}) => {
    // Every update_status reply the app receives, to see what a locked tab is told.
    const statusReplies: string[] = [];
    page.on('websocket', (ws) => {
        ws.on('framereceived', ({ payload }) => {
            const text = typeof payload === 'string' ? payload : payload.toString();
            if (text.includes('"msg":"admin"') && text.includes('"progress"')) statusReplies.push(text);
        });
    });
    await mock.admin({ password: ADMIN_PASSWORD, upgradeMs: 30_000 });

    // Locked: the probe goes out without a session.
    await page.goto('/');
    await loginAs(page);
    const admin = adminScreen(page);
    await admin.tab.click();
    await expect(admin.heading).toHaveText(MESSAGES.admin.unlock.title);
    expect(await mock.statusSessions()).toEqual([false]);

    await admin.adminPassword.fill(ADMIN_PASSWORD);
    await admin.submit.click();
    await page.getByRole('button', { name: MESSAGES.admin.updates.check }).click();
    await expect(admin.updatesHeadline).toHaveText('2 updates available');
    await page.getByRole('button', { name: MESSAGES.admin.updates.upgrade }).click();

    // Unlocked: the polls carry the session, and the full view names the package.
    await expect(page.locator('.updates__package')).toHaveText(/^calaos-(server|container) \(\d of 2\)$/, {
        timeout: 10_000,
    });
    expect((await mock.statusSessions()).slice(1).every(Boolean)).toBe(true);

    // The daemon drops the session: the next poll is refused and the password
    // is asked again, with no error, and nothing is started twice.
    await mock.admin({ clearSessions: true });
    await expect(admin.heading).toHaveText(MESSAGES.admin.unlock.title, { timeout: 10_000 });
    await expect(admin.error).toHaveText('');
    await expect(admin.updates).toHaveCount(0);
    expect((await mock.adminActions()).filter((action) => action === 'update_upgrade_all')).toHaveLength(1);
    // The run is still followed, now in the household view: a read at once, then the poll.
    await expect.poll(async () => (await mock.statusSessions()).slice(-2), { timeout: 8_000 }).toEqual([false, false]);

    // Back on the tab while locked: a sessionless read, answered with the
    // household view — the run's progress without any package name.
    const before = statusReplies.length;
    await page.goto('/#/');
    await admin.tab.click();
    await expect.poll(() => statusReplies.length).toBeGreaterThan(before);
    expect((await mock.statusSessions()).slice(-1)).toEqual([false]);
    const household = JSON.parse(statusReplies[statusReplies.length - 1]).data.result;
    expect(household.progress.status).toBe('upgrading');
    expect(household.progress).not.toHaveProperty('current_pkg');
    expect(household.job).not.toHaveProperty('package');
    expect(JSON.stringify(household)).not.toContain('calaos-');
    await expect(admin.heading).toHaveText(MESSAGES.admin.unlock.title);
});

test('an old calaos-server that never answers gets a clear message after 5 s', async ({ page, mock }) => {
    await mock.admin({ password: ADMIN_PASSWORD, scenario: 'old_server' });
    await page.goto('/');
    await loginAs(page);

    const admin = adminScreen(page);
    const openedAt = Date.now();
    await admin.tab.click();
    await expect(admin.heading).toHaveText(MESSAGES.admin.probing);

    await expect(admin.heading).toHaveText(MESSAGES.admin.notice.oldServer, { timeout: 8_000 });
    expect(Date.now() - openedAt).toBeGreaterThanOrEqual(5_000);
    await expect(page.locator('.admin-notice__hint')).toHaveText(MESSAGES.admin.notice.oldServerHint);
    // Exactly one probe went out; nothing is retried against a server that
    // does not speak the protocol.
    await page.waitForTimeout(1_000);
    expect(await mock.adminActions()).toEqual(['update_status']);
});

test('admin_unavailable retries every 5 s and clears itself once the daemon is back', async ({ page, mock }) => {
    await mock.admin({ password: ADMIN_PASSWORD, scenario: 'unavailable' });
    await page.goto('/');
    await loginAs(page);

    const admin = adminScreen(page);
    await admin.tab.click();
    await expect(admin.heading).toHaveText(MESSAGES.admin.notice.unavailable);
    await expect(page.locator('.admin-notice__hint')).toHaveText(MESSAGES.admin.notice.unavailableHint);

    // Three probes within the first ~11 s: t=0, t=5, t=10.
    await expect
        .poll(async () => (await mock.adminActions()).length, { timeout: 12_000 })
        .toBeGreaterThanOrEqual(3);

    await mock.admin({ scenario: null });
    await expect(admin.heading).toHaveText(MESSAGES.admin.unlock.title, { timeout: 7_000 });
});

test.describe('other blocked states', () => {
    test('https_required says to use https and offers the link', async ({ page, mock }) => {
        await mock.admin({ password: ADMIN_PASSWORD, scenario: 'https_required' });
        await page.goto('/');
        await loginAs(page);
        const admin = adminScreen(page);
        await admin.tab.click();
        await expect(admin.heading).toHaveText(MESSAGES.admin.notice.https);
        await expect(page.locator('.admin__https')).toHaveAttribute('href', /^https:\/\/localhost\/.*#\/admin$/);
    });

    test('daemon_too_old shows activation in progress', async ({ page, mock }) => {
        await mock.admin({ password: ADMIN_PASSWORD, scenario: 'daemon_too_old' });
        await page.goto('/');
        await loginAs(page);
        const admin = adminScreen(page);
        await admin.tab.click();
        await expect(admin.heading).toHaveText(MESSAGES.admin.notice.activating);
    });
});

test('the box actions: restart asks first, the MCP token too, and the password needs an approver', async ({
    page,
    mock,
}) => {
    await mock.admin({ password: ADMIN_PASSWORD });
    const admin = await openUnlocked(page);

    await page.getByRole('button', { name: MESSAGES.admin.actions.rebootConfirm }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(MESSAGES.admin.actions.rebootConfirmTitle);
    await dialog.getByRole('button', { name: MESSAGES.dialog.cancel }).click();
    expect((await mock.adminStatus()).reboots).toBe(0);

    await page.getByRole('button', { name: MESSAGES.admin.actions.regenerate }).click();
    await page.getByRole('dialog').getByRole('button', { name: MESSAGES.admin.actions.mcpConfirm }).click();
    await expect(admin.info).toContainText(MESSAGES.admin.info.mcp_regenerated);
    expect((await mock.adminStatus()).mcpRegenerations).toBe(1);

    await page.getByRole('button', { name: MESSAGES.admin.actions.change }).click();
    const change = page.getByRole('dialog');
    await change.locator('input[type="password"]').first().fill('another long password');
    await change.locator('input[type="password"]').nth(1).fill('another long password');
    await change.locator('.admin-password__submit').click();
    // No approver phone: the change says how to get one (the code flow is e2e/approvers.spec.ts).
    await expect(change.locator('.admin-password__error')).toHaveText(MESSAGES.admin.error.approver_required);
    await change.getByRole('button', { name: MESSAGES.dialog.cancel }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await mock.adminStatus()).toMatchObject({ sessions: 1 });

    await page.getByRole('button', { name: MESSAGES.admin.actions.rebootConfirm }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: MESSAGES.admin.actions.rebootConfirm }).click();
    await expect(admin.info).toContainText(MESSAGES.admin.info.reboot_sent);
    expect((await mock.adminStatus()).reboots).toBe(1);
    expect(CREDENTIALS.user).toBe('demo');
});
