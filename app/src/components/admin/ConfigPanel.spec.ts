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
        config.restoreFollowUp = { phase: 'restarting', previous: null };
        const wrapper = mountPanel();
        await flushPromises();
        expect(wrapper.find('.config__restart button').exists()).toBe(false);
    });

    it('lets go of a box that never came back, and gives the restore button back', async () => {
        const config = useAdminConfigStore();
        config.options = [];
        config.restoreFollowUp = { phase: 'slow', previous: null };
        const wrapper = mountPanel();
        await flushPromises();
        const pick = wrapper.findAll('.config__row button').at(1);
        expect(pick?.attributes('disabled')).toBeDefined();

        await wrapper.find('.config__restart button').trigger('click');

        expect(config.restoreFollowUp).toBeNull();
        expect(wrapper.find('.config__restart').exists()).toBe(false);
        expect(pick?.attributes('disabled')).toBeUndefined();
    });
});
