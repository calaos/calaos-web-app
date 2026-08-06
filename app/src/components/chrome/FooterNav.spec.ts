import { beforeEach, describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory } from 'vue-router';
import FooterNav from './FooterNav.vue';
import en from '../../i18n/en.json';
import { createAppRouter } from '../../router';
import { toHomeData } from '../../protocol/guards';
import { useAuthStore } from '../../stores/auth';
import { useHomeStore } from '../../stores/home';
import type { Router } from 'vue-router';
import type { VueWrapper } from '@vue/test-utils';

let router: Router;

async function mountFooter(path: string): Promise<VueWrapper> {
    await router.push(path);
    await router.isReady();

    return mount(FooterNav, {
        global: {
            plugins: [router, createI18n({ legacy: false, locale: 'en', messages: { en } })],
        },
    });
}

function activeLabels(wrapper: VueWrapper): string[] {
    return wrapper.findAll('.footer-nav__tab--active').map((tab) => tab.text());
}

beforeEach(async () => {
    setActivePinia(createPinia());
    useAuthStore().state = 'authed';
    useHomeStore().setHome(
        toHomeData({
            home: [{ name: 'Salon', type: 'lounge', hits: '1', items: [] }],
            cameras: [{ id: 'cam_1', name: 'Entrée' }],
            audio: [{ id: 'audio_1', name: 'Salon' }],
        }),
    );
    router = createAppRouter(createMemoryHistory());
});

describe('FooterNav', () => {
    it('renders the three sections with their translated labels', async () => {
        const wrapper = await mountFooter('/home');

        const labels = wrapper.findAll('.footer-nav__tab').map((tab) => tab.text());
        expect(labels).toEqual([en.chrome.tabs.home, en.chrome.tabs.audio, en.chrome.tabs.security]);
    });

    it.each([
        ['/home', en.chrome.tabs.home],
        ['/audio', en.chrome.tabs.audio],
        ['/security', en.chrome.tabs.security],
    ])('marks %s as the active tab', async (path, expected) => {
        const wrapper = await mountFooter(path);

        expect(activeLabels(wrapper)).toEqual([expected]);
    });

    it.each([
        ['/home/0', en.chrome.tabs.home],
        ['/audio/audio_1', en.chrome.tabs.audio],
        ['/security/0', en.chrome.tabs.security],
    ])('keeps the section lit on the detail route %s', async (path, expected) => {
        const wrapper = await mountFooter(path);

        expect(activeLabels(wrapper)).toEqual([expected]);
    });

    it('follows route changes without being remounted', async () => {
        const wrapper = await mountFooter('/home');
        expect(activeLabels(wrapper)).toEqual([en.chrome.tabs.home]);

        // The old app's `$state.includes('home')` was evaluated against a
        // scope variable that never existed, so the highlight never moved.
        await router.push('/security');
        await wrapper.vm.$nextTick();

        expect(activeLabels(wrapper)).toEqual([en.chrome.tabs.security]);
    });

    it('moves the light to the active tab and marks it aria-current', async () => {
        const wrapper = await mountFooter('/audio');

        const light = wrapper.get('.footer-nav__light');
        expect(light.attributes('style')).toContain('--tab-index: 1');
        expect(light.classes()).not.toContain('footer-nav__light--off');

        const current = wrapper.findAll('[aria-current="page"]');
        expect(current).toHaveLength(1);
        expect(current[0].text()).toBe(en.chrome.tabs.audio);
    });

    it('hides the light on a route outside every section', async () => {
        const wrapper = await mountFooter('/login');

        expect(activeLabels(wrapper)).toEqual([]);
        expect(wrapper.get('.footer-nav__light').classes()).toContain('footer-nav__light--off');
    });

    it('navigates when a tab is clicked', async () => {
        const wrapper = await mountFooter('/home');

        await wrapper.findAll('.footer-nav__tab')[2].trigger('click');
        await flushPromises();

        expect(router.currentRoute.value.path).toBe('/security');
    });

    it('gives every tab press feedback', async () => {
        const wrapper = await mountFooter('/home');

        for (const tab of wrapper.findAll('.footer-nav__tab')) {
            expect(tab.classes()).toContain('pressable');
        }
    });
});
