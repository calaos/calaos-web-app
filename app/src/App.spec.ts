import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import App from './App.vue';

describe('App', () => {
    it('renders the hello page with the app name and a pressable control', () => {
        const i18n = createI18n({
            legacy: false,
            locale: 'en',
            messages: { en: { app: { name: 'Calaos' } } },
        });

        const wrapper = mount(App, {
            global: { plugins: [i18n] },
        });

        expect(wrapper.text()).toContain('Calaos');
        expect(wrapper.find('.pressable').exists()).toBe(true);
    });
});
