import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { messages } from '../../i18n/messages';
import { useAdminConfigStore } from '../../stores/adminConfig';
import ConfigPanel from './ConfigPanel.vue';

function mountPanel() {
    return mount(ConfigPanel, {
        global: {
            plugins: [createI18n({ legacy: false, locale: 'en', messages })],
            stubs: { Teleport: true },
        },
    });
}

enableAutoUnmount(afterEach);

beforeEach(() => {
    setActivePinia(createPinia());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('ConfigPanel restore follow-up', () => {
    it('offers no way out while the box restarts on time', async () => {
        const config = useAdminConfigStore();
        config.options = [];
        config.restoreFollowUp = { phase: 'restarting', previous: null, partial: false };
        const wrapper = mountPanel();
        await flushPromises();
        expect(wrapper.find('.config__restart button').exists()).toBe(false);
    });

    it('lets go of a box that never came back, and gives the restore button back', async () => {
        const config = useAdminConfigStore();
        config.options = [];
        config.restoreFollowUp = { phase: 'slow', previous: null, partial: false };
        const wrapper = mountPanel();
        await flushPromises();
        const pick = wrapper.findAll('.config__row button').at(1);
        expect(pick?.attributes('disabled')).toBeDefined();

        await wrapper.find('.config__restart button').trigger('click');

        expect(config.restoreFollowUp).toBeNull();
        expect(wrapper.find('.config__restart').exists()).toBe(false);
        expect(pick?.attributes('disabled')).toBeUndefined();
    });

    it('says a partial restore failed while the box restarts, not that it restarts with the restored files', async () => {
        const config = useAdminConfigStore();
        config.options = [];
        config.restoreFollowUp = { phase: 'restarting', previous: '2026/x', partial: true };
        const wrapper = mountPanel();
        await flushPromises();
        const text = wrapper.find('.config__restart-text').text();
        expect(text).toContain('failed half way');
        expect(text).toContain('2026/x');
        expect(text).not.toContain('restored configuration');
    });

    it('keeps the partial failure told after Close on a slow box', async () => {
        const config = useAdminConfigStore();
        config.options = [];
        config.restoreFollowUp = { phase: 'slow', previous: '2026/x', partial: true };
        const wrapper = mountPanel();
        await flushPromises();
        expect(wrapper.find('.config__restart-text').text()).toContain('failed half way');

        await wrapper.find('.config__restart button').trigger('click');

        expect(wrapper.find('.config__restart').exists()).toBe(false);
        expect(wrapper.find('.config__restored-text').text()).toContain('2026/x');
        expect(wrapper.find('.config__restored-text').text()).toContain('failed half way');
    });

    it('says a restore failed half way, with the folder of the previous files', async () => {
        const config = useAdminConfigStore();
        config.options = [];
        config.restoreFollowUp = { phase: 'done', previous: '2026/x', partial: true };
        const wrapper = mountPanel();
        await flushPromises();
        expect(wrapper.find('.config__restored-text').text()).toContain('2026/x');
        expect(wrapper.find('.config__restored-text').text()).toContain('failed half way');
    });
});

describe('ConfigPanel unrestorable files', () => {
    const CAUSES = ['not_loaded', 'missing', 'unreadable', 'empty', 'refused'];
    const causeText = messages.en.admin.config.unrestorableCause as Record<string, string>;

    async function download(unrestorable: { file: string; cause: string }[]) {
        const config = useAdminConfigStore();
        config.options = [];
        vi.spyOn(config, 'downloadBackup').mockResolvedValue({ filename: 'b.zip', blob: new Blob(['x']), unrestorable });
        vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }));
        const wrapper = mountPanel();
        await flushPromises();
        await wrapper.findAll('.config__row button').at(0)?.trigger('click');
        await wrapper.find('.base-dialog__form').trigger('submit');
        await flushPromises();
        return wrapper;
    }

    it('says why each file will not restore, for the five causes, and the download still happens', async () => {
        const wrapper = await download(CAUSES.map((cause) => ({ file: 'io.xml', cause })));
        const note = wrapper.find('.config__unrestorable');
        for (const cause of CAUSES) expect(note.text()).toContain(causeText[cause]);
        expect(wrapper.find('.config__row-note').text()).toContain('Backup saved as b.zip');
    });

    it('shows nothing when the server says nothing', async () => {
        const wrapper = await download([]);
        expect(wrapper.find('.config__unrestorable').exists()).toBe(false);
        expect(wrapper.find('.config__row-note').text()).toContain('Backup saved');
    });

    it('shows a cause from a newer server without breaking', async () => {
        const wrapper = await download([{ file: 'rules.xml', cause: 'from_the_future' }]);
        const note = wrapper.find('.config__unrestorable');
        expect(note.text()).toContain('rules.xml');
        expect(note.text()).toContain(causeText.unknown);
    });
});
