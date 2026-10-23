import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import AdminView from './AdminView.vue';
import en from '../i18n/en.json';
import fr from '../i18n/fr.json';
import { useAdminStore } from '../stores/admin';
import { useAuthStore } from '../stores/auth';
import type { VueWrapper } from '@vue/test-utils';

function mountView(locale: 'en' | 'fr' = 'en'): VueWrapper {
    return mount(AdminView, {
        global: {
            plugins: [createI18n({ legacy: false, locale, messages: { en, fr } })],
            stubs: { Teleport: true },
        },
    });
}

beforeEach(() => {
    setActivePinia(createPinia());
    useAuthStore().state = 'authed';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('AdminView gate screens', () => {
    it('renders the "restart the box" screen with its SSH hint after the activation timeout', async () => {
        // The one screen a user reaches after two minutes of daemon_too_old;
        // its hint contains an `@`, which vue-i18n reads as syntax unless
        // escaped.
        const admin = useAdminStore();
        admin.gate = 'activating';
        admin.rebootHint = true;

        const wrapper = mountView();
        await flushPromises();

        expect(wrapper.find('.admin-notice__title').text()).toBe(en.admin.notice.rebootBox);
        expect(wrapper.find('.admin-notice__hint').text()).toContain('ssh root@<box address>, then reboot');
    });

    it('renders the same screen in French', async () => {
        const admin = useAdminStore();
        admin.gate = 'activating';
        admin.rebootHint = true;

        const wrapper = mountView('fr');
        await flushPromises();

        expect(wrapper.find('.admin-notice__title').text()).toBe(fr.admin.notice.rebootBox);
        expect(wrapper.find('.admin-notice__hint').text()).toContain('ssh root@<adresse de la box>');
    });

    it('shows the activation screen before the timeout, without the hint', async () => {
        const admin = useAdminStore();
        admin.gate = 'activating';

        const wrapper = mountView();
        await flushPromises();

        expect(wrapper.find('.admin-notice__title').text()).toBe(en.admin.notice.activating);
    });

    it('offers the https link as a real link, not a button in a link', async () => {
        const admin = useAdminStore();
        admin.gate = 'https_required';

        const wrapper = mountView();
        await flushPromises();

        const link = wrapper.find('a.admin__https');
        expect(link.exists()).toBe(true);
        expect(link.attributes('href')).toMatch(/^https:\/\/.*#\/admin$/);
        expect(link.find('button').exists()).toBe(false);
    });

    it('probes when mounted and shows the unlock form once the box answers', async () => {
        const admin = useAdminStore();
        const sent: string[] = [];
        admin.attachTransport((frame) => {
            sent.push(frame);
            return true;
        });

        const wrapper = mountView();
        await flushPromises();
        expect(sent).toHaveLength(1);
        expect(wrapper.find('.admin-notice__title').text()).toBe(en.admin.probing);

        admin.gate = 'locked';
        await flushPromises();
        expect(wrapper.find('.admin__heading').text()).toBe(en.admin.unlock.title);
        expect(wrapper.find('.admin-password input[type="password"]').exists()).toBe(true);
    });
});
