import { beforeEach, describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory } from 'vue-router';
import NavBar from './NavBar.vue';
import en from '../../i18n/en.json';
import { createAppRouter } from '../../router';
import { toHomeData } from '../../protocol/guards';
import { useAuthStore } from '../../stores/auth';
import { useHomeStore } from '../../stores/home';
import type { Router } from 'vue-router';
import type { VueWrapper } from '@vue/test-utils';

let router: Router;

async function mountNavBar(path: string): Promise<VueWrapper> {
    await router.push(path);
    await router.isReady();

    return mount(NavBar, {
        global: {
            plugins: [router, createI18n({ legacy: false, locale: 'en', messages: { en } })],
        },
    });
}

function button(wrapper: VueWrapper, label: string) {
    return wrapper.find(`[aria-label="${label}"]`);
}

beforeEach(() => {
    setActivePinia(createPinia());
    useAuthStore().state = 'authed';
    useHomeStore().setHome(
        toHomeData({
            home: [{ name: 'Salon', type: 'lounge', hits: '1', items: [] }],
            cameras: [{ id: 'cam_1', name: 'Entrée' }],
            audio: [],
        }),
    );
    router = createAppRouter(createMemoryHistory());
});

describe('NavBar', () => {
    it('shows the wordmark and the sign-out control', async () => {
        const wrapper = await mountNavBar('/home');

        expect(wrapper.get('.navbar__wordmark').text()).toBe(en.app.name);
        expect(button(wrapper, en.chrome.signOut).exists()).toBe(true);
    });

    it('hides the back button on list routes', async () => {
        const wrapper = await mountNavBar('/home');

        expect(button(wrapper, en.chrome.back).exists()).toBe(false);
    });

    it('shows the back button on meta.detail routes', async () => {
        const wrapper = await mountNavBar('/home/0');

        expect(button(wrapper, en.chrome.back).exists()).toBe(true);
    });

    it('goes one path segment up, not one history entry back', async () => {
        // A deep-linked reload of /security/0 has no in-app history entry;
        // the old $window.history.back() left the app entirely.
        const wrapper = await mountNavBar('/security/0');

        await button(wrapper, en.chrome.back).trigger('click');
        await flushPromises();

        expect(router.currentRoute.value.path).toBe('/security');
    });

    it('signs out when the sign-out button is pressed', async () => {
        const auth = useAuthStore();
        auth.signIn('demo', 'demo');
        auth.state = 'authed';
        const wrapper = await mountNavBar('/home');

        await button(wrapper, en.chrome.signOut).trigger('click');

        expect(auth.state).toBe('idle');
        expect(auth.user).toBe('');
        // Navigation is an intent; the router watcher performs the push.
        expect(auth.pendingNavigation).toBe('login');
    });
});
