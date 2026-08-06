import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory } from 'vue-router';
import App from './App.vue';
import en from './i18n/en.json';
import { createAppRouter } from './router';
import { toHomeData } from './protocol/guards';
import { useAuthStore } from './stores/auth';
import { useConnectionStore } from './stores/connection';
import { useHomeStore } from './stores/home';
import type { Router } from 'vue-router';
import type { VueWrapper } from '@vue/test-utils';

let router: Router;

async function mountApp(path: string): Promise<VueWrapper> {
    await router.push(path);
    await router.isReady();

    return mount(App, {
        global: {
            plugins: [router, createI18n({ legacy: false, locale: 'en', messages: { en } })],
        },
    });
}

beforeEach(() => {
    setActivePinia(createPinia());
    router = createAppRouter(createMemoryHistory());
});

describe('App shell', () => {
    it('always paints the backdrop', async () => {
        const wrapper = await mountApp('/login');

        const background = wrapper.get('.app-background');
        // Fades in on the image's own load event, so it starts hidden.
        expect(background.classes()).not.toContain('app-background--loaded');
        expect(background.attributes('aria-hidden')).toBe('true');
    });

    it('gives the whole viewport to the login screen', async () => {
        const wrapper = await mountApp('/login');

        expect(wrapper.find('.navbar').exists()).toBe(false);
        expect(wrapper.find('.footer-nav').exists()).toBe(false);
        expect(wrapper.find('.app-shell__content').exists()).toBe(true);
    });

    it('slides the chrome in once authenticated', async () => {
        useAuthStore().state = 'authed';
        const wrapper = await mountApp('/home');

        expect(wrapper.get('.navbar').classes()).toContain('fade-in-down');
        expect(wrapper.get('.footer-nav').classes()).toContain('fade-in-up');
    });

    it('shows the connection banner regardless of the auth state', async () => {
        useConnectionStore().showBanner = true;
        const wrapper = await mountApp('/login');

        expect(wrapper.find('.connection-banner').exists()).toBe(true);
    });

    it('renders the routed view inside the scrolling area', async () => {
        useAuthStore().state = 'authed';
        useHomeStore().setHome(
            toHomeData({
                home: [{ name: 'Cuisine', type: 'kitchen', hits: '1', items: [] }],
                cameras: [],
                audio: [],
            }),
        );

        const wrapper = await mountApp('/home');

        expect(wrapper.get('.app-shell__content').text()).toContain('Cuisine');
    });
});
