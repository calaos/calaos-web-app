import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import RebootButton from './RebootButton.vue';
import en from '../../i18n/en.json';
import { useAdminStore } from '../../stores/admin';
import type { VueWrapper } from '@vue/test-utils';

function mountButton(props: { disabled?: boolean } = {}): VueWrapper {
    return mount(RebootButton, {
        props: { label: 'Restart', ...props },
        global: {
            plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })],
            stubs: { Teleport: true },
        },
    });
}


beforeEach(() => {
    setActivePinia(createPinia());
});

describe('RebootButton', () => {
    it('sends nothing until the question is answered', async () => {
        const admin = useAdminStore();
        const reboot = vi.spyOn(admin, 'reboot').mockResolvedValue();
        const wrapper = mountButton();
        expect(wrapper.find('[role="dialog"]').exists()).toBe(false);

        await wrapper.find('button').trigger('click');
        expect(wrapper.find('[role="dialog"]').text()).toContain(en.admin.actions.rebootConfirmTitle);
        expect(reboot).not.toHaveBeenCalled();

        await wrapper.find('[role="dialog"] form').trigger('submit');
        expect(reboot).toHaveBeenCalledOnce();
        expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    });

    it('lets the question go', async () => {
        const reboot = vi.spyOn(useAdminStore(), 'reboot').mockResolvedValue();
        const wrapper = mountButton();
        await wrapper.find('button').trigger('click');
        await wrapper.find('.base-dialog__actions button[type="button"]').trigger('click');
        expect(reboot).not.toHaveBeenCalled();
        expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    });

    it('does not open while disabled', async () => {
        const wrapper = mountButton({ disabled: true });
        expect(wrapper.find('button').attributes('disabled')).toBeDefined();
    });

    it('spins while the restart is being sent', () => {
        useAdminStore().busy = 'system_reboot';
        const wrapper = mountButton();
        expect(wrapper.find('.admin-button__spinner').exists()).toBe(true);
    });
});
