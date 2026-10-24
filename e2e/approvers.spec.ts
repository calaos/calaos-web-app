// Approver phones and push codes against the mock's fake daemon: the first
// enrolment, a second one approved by the first phone, the last phone that
// cannot be removed, the password change with a code, wrong and expired
// codes, and the alert banner at sign-in. The code a phone "receives" is read
// back from the mock (`mock.lastCode()`).

import { MESSAGES, MOCK_PHONES, adminScreen, expect, loginAs, test } from './fixtures';
import type { Page } from '@playwright/test';

const ADMIN_PASSWORD = 'correct horse battery';
const t = MESSAGES.admin;

/** vue-i18n's `{name}` placeholders, filled the way the app does. */
function fill(text: string, values: Record<string, string | number>): string {
    return text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key]));
}

test.beforeEach(async ({ mock }) => {
    await mock.reset();
    await mock.admin({ password: ADMIN_PASSWORD, codeIntervalMs: 1_000 });
});

async function openUnlocked(page: Page): Promise<void> {
    await page.goto('/');
    await loginAs(page);
    const admin = adminScreen(page);
    await admin.tab.click();
    await admin.adminPassword.fill(ADMIN_PASSWORD);
    await admin.submit.click();
    await expect(admin.updates).toBeVisible();
}

function section(page: Page) {
    return page.locator('.approvers');
}

function codeField(page: Page) {
    return page.getByRole('dialog').getByLabel(t.code.label);
}

test('first phone: pick it among look-alikes, type the code it received, and it is listed', async ({ page, mock }) => {
    await openUnlocked(page);
    await expect(section(page)).toContainText(t.approvers.none);

    await section(page).getByRole('button', { name: t.approvers.add }).click();
    const dialog = page.getByRole('dialog');
    const choices = dialog.locator('.approvers__choice');
    await expect(choices).toHaveCount(3);
    // The two iPhones are told apart by the end of their id, platform and dates.
    await expect(choices.nth(1)).toContainText(fill(t.approvers.reference, { suffix: '0718' }));
    await expect(choices.nth(2)).toContainText(fill(t.approvers.reference, { suffix: '3921' }));
    await expect(choices.nth(0)).not.toContainText('Ref.');
    await expect(choices.nth(1)).toContainText(t.approvers.platform.ios);
    await expect(choices.nth(1)).toContainText('Last active 2 hours ago');
    await expect(choices.nth(2)).toContainText('Last active 3 days ago');

    await choices.filter({ hasText: MOCK_PHONES.pixel.name }).click();
    await dialog.getByRole('button', { name: t.approvers.pick.next }).click();
    await expect(dialog).toContainText(t.code.confirm_enroll.title);
    await expect(dialog).toContainText(fill(t.code.confirm_enroll.hint, { phone: MOCK_PHONES.pixel.name }));

    const pushed = await mock.lastCode();
    expect(pushed).toMatchObject({ token_id: MOCK_PHONES.pixel.tokenId, action: 'enroll' });
    await codeField(page).fill(pushed.code);

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(section(page)).toContainText(t.approvers.enrolled);
    await expect(section(page).locator('.approvers__row')).toHaveCount(1);
    await expect(section(page).locator('.approvers__row')).toContainText(MOCK_PHONES.pixel.name);
    expect((await mock.adminStatus()).approvers.map((a) => a.token_id)).toEqual([MOCK_PHONES.pixel.tokenId]);
    // Our own enrolment is not reported back to us as an alert.
    await page.waitForTimeout(500);
    await expect(page.getByRole('alert', { name: t.alerts.label })).toHaveCount(0);
});

test('second phone: the first one approves with its code, then the new one confirms', async ({ page, mock }) => {
    await mock.admin({ approvers: [MOCK_PHONES.pixel.tokenId] });
    await openUnlocked(page);
    await expect(section(page).locator('.approvers__row')).toHaveCount(1);

    await section(page).getByRole('button', { name: t.approvers.add }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.approvers__choice').first()).toContainText(t.approvers.pick.already);
    await expect(dialog).toContainText(t.approvers.pick.secondHint);
    await dialog.locator('.approvers__choice').filter({ hasText: '0718' }).click();
    await dialog.getByRole('button', { name: t.approvers.pick.next }).click();

    await expect(dialog).toContainText(t.code.approve_enroll.title);
    await expect(dialog).toContainText(fill(t.code.approve_enroll.hint, { phone: MOCK_PHONES.pixel.name }));
    const approval = await mock.lastCode();
    expect(approval).toMatchObject({ token_id: MOCK_PHONES.pixel.tokenId, action: 'approver_enroll' });
    await codeField(page).fill(approval.code);

    await expect(dialog).toContainText(t.code.confirm_enroll.title);
    const own = await mock.lastCode();
    expect(own).toMatchObject({ token_id: MOCK_PHONES.oldIphone.tokenId, action: 'enroll' });
    await codeField(page).fill(own.code);

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(section(page).locator('.approvers__row')).toHaveCount(2);
    // Two at most: no third.
    await expect(section(page)).toContainText(t.approvers.max);
    await expect(section(page).getByRole('button', { name: t.approvers.add })).toHaveCount(0);
});

test('the last phone cannot be removed, and the way out is spelled', async ({ page, mock }) => {
    await mock.admin({ approvers: [MOCK_PHONES.pixel.tokenId] });
    await openUnlocked(page);

    await section(page).getByRole('button', { name: t.approvers.remove }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: t.approvers.removeConfirm }).click();
    await expect(dialog).toContainText(t.approvers.last.title);
    await expect(dialog).toContainText(t.approvers.last.body);
    await expect(dialog).toContainText('calaos-os admin reset');
    expect((await mock.adminStatus()).pushed).toEqual([]);
    await dialog.getByRole('button', { name: t.dismiss }).click();
    await expect(section(page).locator('.approvers__row')).toHaveCount(1);
});

test('with two phones, a code removes one', async ({ page, mock }) => {
    await mock.admin({ approvers: [MOCK_PHONES.pixel.tokenId, MOCK_PHONES.newIphone.tokenId] });
    await openUnlocked(page);

    await section(page).locator('.approvers__row').filter({ hasText: 'iPhone' }).getByRole('button', { name: t.approvers.remove }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: t.approvers.removeConfirm }).click();
    await expect(dialog).toContainText(t.code.remove.title);
    await codeField(page).fill((await mock.lastCode()).code);
    await expect(section(page)).toContainText(t.approvers.removed);
    await expect(section(page).locator('.approvers__row')).toHaveCount(1);
    await expect(section(page).locator('.approvers__row')).toContainText(MOCK_PHONES.pixel.name);
});

test('password change: request a code, type it, and the new password is in', async ({ page, mock }) => {
    await mock.admin({ approvers: [MOCK_PHONES.pixel.tokenId] });
    await openUnlocked(page);
    const admin = adminScreen(page);

    await page.getByRole('button', { name: t.actions.change }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(t.change.codeHint);
    await dialog.locator('input[type="password"]').first().fill('another long password');
    await dialog.locator('input[type="password"]').nth(1).fill('another long password');
    await dialog.locator('.admin-password__submit').click();

    await expect(dialog).toContainText(t.code.password.title);
    const pushed = await mock.lastCode();
    expect(pushed.action).toBe('admin_password');
    await codeField(page).fill(pushed.code);

    await expect(admin.info).toContainText(t.info.password_changed);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(admin.updates).toBeVisible();
    expect(await mock.adminStatus()).toMatchObject({ sessions: 1 });
});

test('a wrong code counts down, an expired one says so, and a new code works', async ({ page, mock }) => {
    await mock.admin({ approvers: [MOCK_PHONES.pixel.tokenId] });
    await openUnlocked(page);

    await page.getByRole('button', { name: t.actions.change }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input[type="password"]').first().fill('another long password');
    await dialog.locator('input[type="password"]').nth(1).fill('another long password');
    await dialog.locator('.admin-password__submit').click();
    await expect(dialog).toContainText('Valid for');

    const first = await mock.lastCode();
    await codeField(page).fill(first.code === '000000' ? '111111' : '000000');
    await expect(dialog.getByRole('alert')).toHaveText('Wrong code. 4 attempts left.');
    await expect(codeField(page)).toHaveValue('');

    await mock.admin({ expireCodes: true });
    await codeField(page).fill(first.code);
    await expect(dialog.getByRole('alert')).toHaveText(t.code.expired);

    await dialog.getByRole('button', { name: t.code.resend }).click();
    await expect.poll(async () => (await mock.lastCode()).code_id).not.toBe(first.code_id);
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(dialog).toContainText('4 attempts left');
    await codeField(page).fill((await mock.lastCode()).code);
    await expect(adminScreen(page).info).toContainText(t.info.password_changed);
});

test('an approver change made elsewhere shows a banner at sign-in until acknowledged', async ({ page, mock }) => {
    await mock.admin({ alerts: [{ type: 'approver_set', device_name: 'Tablette cuisine' }] });
    await page.goto('/');
    await loginAs(page);

    const banner = page.getByRole('alert', { name: t.alerts.label });
    await expect(banner).toContainText(fill(t.alerts.approver_set, { name: 'Tablette cuisine' }));
    await expect(banner).toContainText(t.alerts.hint);
    await banner.getByRole('button', { name: t.alerts.dismiss }).click();
    await expect(banner).toHaveCount(0);

    // Dismissed for this browser, across reloads.
    await page.reload();
    await loginAs(page);
    await page.waitForTimeout(500);
    await expect(banner).toHaveCount(0);

    // A live alert while signed in: the name comes from the event log.
    await mock.admin({ alerts: [{ type: 'approver_removed', device_name: 'iPhone' }] });
    await expect(banner).toContainText(fill(t.alerts.approver_removed, { name: 'iPhone' }));
});
