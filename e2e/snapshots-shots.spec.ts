// Captures of the snapshots page, the rescue banner and their dialogs, in both
// languages at a phone and a desktop width, for the UI review
// (ARCHI_SHOT=1; the files land in this test's output folder).

import type { Page } from '@playwright/test';
import en from '../app/src/i18n/en.json';
import fr from '../app/src/i18n/fr.json';
import snapEn from '../app/src/i18n/admin/snapshots.en.json';
import snapFr from '../app/src/i18n/admin/snapshots.fr.json';
import { adminScreen, expect, loginAs, settled, test } from './fixtures';
import type { ControlOp, MockControl } from './fixtures';

const ADMIN_PASSWORD = 'correct horse battery';
const WIDTHS = [380, 1300];


const LOCALES = [
    { tag: 'en', locale: 'en-US', app: en, snap: snapEn },
    { tag: 'fr', locale: 'fr-FR', app: fr, snap: snapFr },
] as const;

async function configure(mock: MockControl, patch: Record<string, unknown>): Promise<void> {
    await mock.send({ op: 'admin', snapshots: patch } as unknown as ControlOp);
}

for (const L of LOCALES) {
    test.describe(`captures ${L.tag}`, () => {
        test.use({ locale: L.locale });

        test.beforeEach(async ({ mock }) => {
            await mock.reset();
            await mock.admin({ password: ADMIN_PASSWORD });
        });

        async function signIn(page: Page, width: number, closeInfo = true): Promise<void> {
            await page.setViewportSize({ width, height: width < 600 ? 800 : 900 });
            await page.goto('/');
            await loginAs(page);
            if (closeInfo) {
                const info = page.getByRole('dialog');
                if (await info.isVisible({ timeout: 1500 }).catch(() => false)) {
                    await info.getByRole('button').first().click();
                }
            }
        }

        async function unlockAndOpen(page: Page): Promise<void> {
            const admin = adminScreen(page);
            await admin.tab.click();
            await admin.adminPassword.fill(ADMIN_PASSWORD);
            await admin.submit.click();
            await page.locator('[data-page="snapshots"]').click();
            await expect(page).toHaveURL(/#\/admin\/snapshots$/);
        }

        const states: Array<{
            name: string;
            patch?: Record<string, unknown>;
            run?: (page: Page) => Promise<void>;
            hub?: boolean;
        }> = [
            { name: 'list', run: async (p) => { await expect(p.locator('[data-snapshot]').first()).toBeAttached(); } },
            { name: 'empty', patch: { empty: true } },
            { name: 'loading', patch: { delayMs: 8000 } },
            { name: 'unreachable', patch: { fail: { snapshots_list: 'admin_unavailable' } } },
            { name: 'too-old', patch: { fail: { snapshots_list: 'daemon_too_old' } } },
            { name: 'snapper-ko', patch: { fail: { snapshots_list: 'rescue_unavailable' } } },
            { name: 'rescue', patch: { rescue: 142 } },
            {
                name: 'refused',
                patch: { failOnce: { snapshot_boot: 'not_bootable' } },
                run: async (p) => {
                    await p.locator('[data-snapshot="142"]:visible').getByRole('button').click();
                    await p.getByRole('dialog').getByRole('button').last().click();
                    await expect(p.getByRole('alert')).toBeVisible();
                },
            },
            {
                name: 'upgrade-in-progress',
                patch: { failOnce: { snapshot_boot: 'upgrade_in_progress' } },
                run: async (p) => {
                    await p.locator('[data-snapshot="142"]:visible').getByRole('button').click();
                    await p.getByRole('dialog').getByRole('button').last().click();
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
                name: 'rebooting',
                patch: { rebootMs: 60000 },
                run: async (p) => {
                    await p.locator('[data-snapshot="142"]:visible').getByRole('button').click();
                    await p.getByRole('dialog').getByRole('button').last().click();
                    await expect(p.getByRole('dialog')).toHaveCount(0);
                },
            },
            {
                name: 'outcome-unknown',
                patch: { unknownOutcome: true },
                run: async (p) => {
                    await p.locator('[data-snapshot="142"]:visible').getByRole('button').click();
                    await p.getByRole('dialog').getByRole('button').last().click();
                    await expect(p.getByRole('dialog')).toHaveCount(0);
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
        ];

        for (const width of WIDTHS) {
            for (const state of states) {
                test(`${state.name} ${width}`, async ({ page, mock }, testInfo) => {
                    test.skip(testInfo.project.name !== 'chromium-desktop');
                    if (state.patch) await configure(mock, state.patch);
                    await signIn(page, width, true);
                    const admin = adminScreen(page);
                    if (state.hub) {
                        await admin.tab.click();
                        await admin.adminPassword.fill(ADMIN_PASSWORD);
                        await admin.submit.click();
                        await expect(admin.hub).toBeVisible();
                    } else {
                        await unlockAndOpen(page);
                    }
                    if (state.run) await state.run(page);
                    await settled(page);
                    await page.screenshot({ path: testInfo.outputPath(`${L.tag}-${width}-${state.name}.png`) });
                });
            }

            test(`banner and info dialog ${width}`, async ({ page, mock }, testInfo) => {
                test.skip(testInfo.project.name !== 'chromium-desktop');
                await configure(mock, { rescue: 142 });
                await signIn(page, width, false);
                await expect(page.getByRole('dialog')).toBeVisible();
                await settled(page);
                await page.screenshot({ path: testInfo.outputPath(`${L.tag}-${width}-info-dialog.png`) });
                await page.getByRole('dialog').getByRole('button').first().click();
                await expect(page.locator('[data-rescue-banner]')).toBeVisible();
                await settled(page);
                await page.screenshot({ path: testInfo.outputPath(`${L.tag}-${width}-banner-home.png`) });
            });
        }
    });
}
