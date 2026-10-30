import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { messages } from '../../i18n/messages';
import type { RestoreManifest } from '../../protocol/backup-zip';
import ConfigRestoreDialog from './ConfigRestoreDialog.vue';

const COUNTS = { rooms: 1, ios: 2, devices: 3, rules: 4 };
const PREVIEW = {
    dryRun: true,
    ioFormat: 2,
    restarting: false,
    backup: COUNTS,
    box: COUNTS,
    files: ['io.xml'],
    warnings: [],
    kept: [],
    previous: null,
};
const MANIFEST = { hostname: 'maison', createdAt: '2026-10-25T09:12:58Z', serverVersion: '4.6.0' };

function titleOf(manifest: RestoreManifest | null): string {
    const wrapper = mount(ConfigRestoreDialog, {
        props: {
            preview: PREVIEW,
            manifest,
            sending: false,
            error: '',
            downloadFirst: true,
        },
        global: {
            plugins: [createI18n({ legacy: false, locale: 'en', messages })],
            stubs: { Teleport: true },
        },
    });
    return wrapper.find('.base-dialog__title').text();
}

enableAutoUnmount(afterEach);

beforeEach(() => {
    setActivePinia(createPinia());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('ConfigRestoreDialog title', () => {
    it('names the box, the date and the version of the file', () => {
        const title = titleOf(MANIFEST);
        expect(title).toContain('maison');
        expect(title).toContain('(Calaos 4.6.0)');
    });

    it('falls back to the plain title when the file does not say it all', () => {
        const bare = messages.en.admin.config.restoreTitleBare;
        expect(titleOf(null)).toBe(bare);
        expect(titleOf({ ...MANIFEST, hostname: '' })).toBe(bare);
        expect(titleOf({ ...MANIFEST, serverVersion: '' })).toBe(bare);
        expect(titleOf({ ...MANIFEST, createdAt: 'not a date' })).toBe(bare);
    });

    it('clips what a crafted file would stretch across the dialog', () => {
        const title = titleOf({ ...MANIFEST, hostname: 'h'.repeat(5000), serverVersion: 'v'.repeat(5000) });
        expect(title).toContain(`${'h'.repeat(62)}…`);
        expect(title).toContain(`${'v'.repeat(62)}…`);
        expect(title).not.toContain('h'.repeat(63));
    });
});
