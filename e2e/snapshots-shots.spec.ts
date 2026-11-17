// Captures of the snapshots page, the rescue banner and their dialogs, in both
// languages at a phone and a desktop width, for the UI review
// (ARCHI_SHOT=1; the files land in this test's output folder).
// One test per locale and width, one login: the states are switched through the
// mock and a dropped socket, and the page is shot at the top of its scroll.

import type { Page } from '@playwright/test';
import { adminScreen, expect, loginAs, settled, test } from './fixtures';
import type { ControlOp, MockControl } from './fixtures';

const ADMIN_PASSWORD = 'correct horse battery';
const WIDTHS = [380, 1300];
const LOCALES = [
    { tag: 'en', locale: 'en-US' },
    { tag: 'fr', locale: 'fr-FR' },
] as const;

const NEUTRAL = {
    rescue: false,
    empty: false,
    delayMs: 0,
    rebootMs: 1000,
    unknownOutcome: false,
    tooOld: [],
    fail: { snapshots_list: null, snapshot_boot: null, snapshot_rollback: null, rescue_status: null },
    failOnce: { snapshots_list: null, snapshot_boot: null, snapshot_rollback: null, rescue_status: null },
};

async function configure(mock: MockControl, patch: Record<string, unknown>): Promise<void> {
    await mock.send({ op: 'admin', snapshots: { ...NEUTRAL, ...patch } } as unknown as ControlOp);
}

async function unlock(page: Page): Promise<void> {
    const admin = adminScreen(page);
    await admin.tab.click();
    await admin.adminPassword.fill(ADMIN_PASSWORD);
    await admin.submit.click();
    await expect(admin.hub).toBeVisible();
}

async function closeInfo(page: Page): Promise<void> {
    const info = page.getByRole('dialog');
    if (await info.isVisible({ timeout: 1500 }).catch(() => false)) {
        await info.getByRole('button').first().click();
    }
}

interface Step {
    name: string;
    patch?: Record<string, unknown>;
    run?: (page: Page) => Promise<void>;
    hub?: boolean;
    /** Frame this element instead of the top of the page. */
    focus?: string;
    /** The box goes down: sign in again afterwards. */
    reboots?: boolean;
}

const bootFirst = async (p: Page): Promise<void> => {
    await p.locator('[data-snapshot="142"]:visible').getByRole('button').click();
    await p.getByRole('dialog').getByRole('button').last().click();
};

const STEPS: Step[] = [
    { name: 'list', run: async (p) => { await expect(p.locator('[data-snapshot]').first()).toBeAttached(); } },
    { name: 'empty', patch: { empty: true } },
    { name: 'loading', patch: { delayMs: 8000 } },
    { name: 'unreachable', patch: { fail: { snapshots_list: 'admin_unavailable' } } },
    { name: 'too-old', patch: { fail: { snapshots_list: 'daemon_too_old' } } },
    { name: 'snapper-ko', patch: { fail: { snapshots_list: 'rescue_unavailable' } } },
    { name: 'rescue', patch: { rescue: 142 } },
    { name: 'current-row', patch: { rescue: 142 }, focus: '.snaps__row--current' },
    {
        name: 'refused',
        patch: { failOnce: { snapshot_boot: 'not_bootable' } },
        run: async (p) => {
            await bootFirst(p);
            await expect(p.getByRole('alert')).toBeVisible();
        },
    },
    {
        name: 'upgrade-in-progress',
        patch: { failOnce: { snapshot_boot: 'upgrade_in_progress' } },
        run: async (p) => {
            await bootFirst(p);
            await expect(p.getByRole('alert')).toBeVisible();
        },
    },
    {
        name: 'boot-dialog',
        run: async (p) => {
            await p.locator('[data-snapshot="142"]:visible').getByRole('button').click();
            await expect(p.getByRole('dialog')).toBeVisible();
        },
    },
    {
        name: 'rollback-dialog',
        patch: { rescue: 142 },
        run: async (p) => {
            await p.locator('.rescue__actions button').first().click();
            await expect(p.getByRole('dialog')).toBeVisible();
        },
    },
    {
        name: 'rollback-dialog-ticked',
        patch: { rescue: 142 },
        run: async (p) => {
            await p.locator('.rescue__actions button').first().click();
            await p.getByRole('dialog').getByRole('checkbox').check();
        },
    },
    {
        name: 'normal-dialog',
        patch: { rescue: 142 },
        run: async (p) => {
            await p.locator('.rescue__actions button').last().click();
            await expect(p.getByRole('dialog')).toBeVisible();
        },
    },
    { name: 'hub-rescue', patch: { rescue: 142 }, hub: true },
    {
        name: 'outcome-unknown',
        patch: { unknownOutcome: true },
        reboots: true,
        run: async (p) => {
            await bootFirst(p);
            await expect(p.getByRole('dialog')).toHaveCount(0);
        },
    },
    {
        name: 'rebooting',
        patch: { rebootMs: 60000 },
        reboots: true,
        run: async (p) => {
            await bootFirst(p);
            await expect(p.getByRole('dialog')).toHaveCount(0);
        },
    },
];

for (const L of LOCALES) {
    test.describe(`captures ${L.tag}`, () => {
        test.use({ locale: L.locale });

        for (const width of WIDTHS) {
            test(`snapshots states ${L.tag} ${width}`, async ({ page, mock }, testInfo) => {
                test.skip(testInfo.project.name !== 'chromium-desktop');
                test.setTimeout(240_000);
                const scroller = page.locator('.app-shell__content');
                const shoot = async (name: string, focus?: string): Promise<void> => {
                    await settled(page);
                    if (focus) await page.locator(focus).locator('visible=true').first().scrollIntoViewIfNeeded();
                    else await scroller.evaluate((el) => (el.scrollTop = 0));
                    await page.screenshot({ path: testInfo.outputPath(`${L.tag}-${width}-${name}.png`) });
                };
                const signIn = async (patch: Record<string, unknown>, closeDialog: boolean): Promise<void> => {
                    await mock.reset();
                    await mock.admin({ password: ADMIN_PASSWORD });
                    await configure(mock, patch);
                    await page.setViewportSize({ width, height: width < 600 ? 800 : 900 });
                    await page.goto('/');
                    await loginAs(page);
                    if (closeDialog) await closeInfo(page);
                };

                // The banner and the information dialog come with the household login.
                await signIn({ rescue: 142 }, false);
                await expect(page.getByRole('dialog')).toBeVisible();
                await shoot('info-dialog');
                await page.getByRole('dialog').getByRole('button').first().click();
                await expect(page.locator('[data-rescue-banner]')).toBeVisible();
                await shoot('banner-home');

                await signIn({}, true);
                await unlock(page);
                let needsSignIn = false;
                for (const step of STEPS) {
                    if (needsSignIn) {
                        await signIn(step.patch ?? {}, true);
                        await unlock(page);
                    } else {
                        await configure(mock, step.patch ?? {});
                        // The socket comes back with its own login and reads the rescue status again.
                        const reads = async (): Promise<number> =>
                            (await mock.adminActions()).filter((action) => action === 'rescue_status').length;
                        const before = await reads();
                        await mock.drop();
                        await expect.poll(reads, { timeout: 15_000 }).toBeGreaterThan(before);
                        await expect(page.locator('[data-rescue-banner]')).toHaveCount(step.patch?.rescue === undefined ? 0 : 1, { timeout: 15_000 });
                        await page.evaluate(() => { window.location.hash = '#/admin'; });
                        await expect(adminScreen(page).hub).toBeVisible();
                    }
                    if (!step.hub) {
                        await page.locator('[data-page="snapshots"]').click();
                        await expect(page).toHaveURL(/#\/admin\/snapshots$/);
                    }
                    if (step.run) await step.run(page);
                    await shoot(step.name, step.focus);
                    needsSignIn = step.reboots === true;
                }
            });
        }
    });
}
