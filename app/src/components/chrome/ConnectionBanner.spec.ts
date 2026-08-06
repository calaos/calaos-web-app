import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import ConnectionBanner from './ConnectionBanner.vue';
import en from '../../i18n/en.json';
import { useConnectionStore } from '../../stores/connection';

function mountBanner() {
    return mount(ConnectionBanner, {
        global: {
            plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })],
        },
    });
}

beforeEach(() => {
    setActivePinia(createPinia());
});

describe('ConnectionBanner', () => {
    it('renders nothing while the store keeps the banner down', () => {
        const wrapper = mountBanner();

        expect(useConnectionStore().showBanner).toBe(false);
        expect(wrapper.find('.connection-banner').exists()).toBe(false);
    });

    it('appears when the store raises showBanner, and hides again', async () => {
        const connection = useConnectionStore();
        const wrapper = mountBanner();

        // The 1 s debounce itself is covered in stores/connection.spec.ts;
        // this component only mirrors the resulting flag.
        connection.showBanner = true;
        await wrapper.vm.$nextTick();
        expect(wrapper.find('.connection-banner').exists()).toBe(true);

        connection.showBanner = false;
        await wrapper.vm.$nextTick();
        expect(wrapper.find('.connection-banner').exists()).toBe(false);
    });

    it('announces politely and says what happened', async () => {
        const connection = useConnectionStore();
        const wrapper = mountBanner();
        connection.showBanner = true;
        await wrapper.vm.$nextTick();

        const banner = wrapper.get('.connection-banner');
        expect(banner.attributes('role')).toBe('status');
        expect(banner.attributes('aria-live')).toBe('polite');
        expect(banner.text()).toContain(en.chrome.connection.lost);
        expect(banner.text()).toContain(en.chrome.connection.retrying);
    });

    it('offers no control — a dropped socket must not invite a sign-out', async () => {
        const connection = useConnectionStore();
        const wrapper = mountBanner();
        connection.showBanner = true;
        await wrapper.vm.$nextTick();

        expect(wrapper.findAll('button, a')).toHaveLength(0);
    });
});
