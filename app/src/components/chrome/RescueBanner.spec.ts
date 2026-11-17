import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';
import { messages } from '../../i18n/messages';
import { useAuthStore } from '../../stores/auth';
import { useRescueStore } from '../../stores/rescue';
import RescueBanner from './RescueBanner.vue';
import RescueInfoDialog from './RescueInfoDialog.vue';

const stub = { template: '<div />' };

function mountBoth() {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', name: 'home', component: stub },
            { path: '/admin/snapshots', name: 'adminSnapshots', component: stub },
        ],
    });
    const wrapper = mount(
        { components: { RescueBanner, RescueInfoDialog }, template: '<RescueBanner /><RescueInfoDialog />' },
        {
            global: { plugins: [router, createI18n({ legacy: false, locale: 'en', messages })] },
            attachTo: document.body,
        },
    );
    return { wrapper, router };
}

function setRescue(snapshot: number | null, rescue = true): void {
    useRescueStore().status = { rescue, overlay: rescue, snapshot };
}

beforeEach(() => {
    setActivePinia(createPinia());
    sessionStorage.clear();
    document.body.innerHTML = '';
    useAuthStore().$patch({ state: 'authed' });
});

describe('RescueBanner', () => {
    it('is absent outside rescue mode', () => {
        setRescue(null, false);
        const { wrapper } = mountBoth();
        expect(wrapper.find('[data-rescue-banner]').exists()).toBe(false);
    });

    it('names the snapshot and has no admin action', async () => {
        setRescue(145);
        const { wrapper } = mountBoth();
        await wrapper.vm.$nextTick();
        const banner = wrapper.find('[data-rescue-banner]');
        expect(banner.attributes('role')).toBe('status');
        expect(banner.text()).toContain('snapshot #145');
        expect(banner.findAll('button')).toHaveLength(1);
        wrapper.unmount();
    });

    it('is hidden before the household login', () => {
        useAuthStore().$patch({ state: 'idle' });
        setRescue(145);
        const { wrapper } = mountBoth();
        expect(wrapper.find('[data-rescue-banner]').exists()).toBe(false);
    });

    it('falls back to a text without id when the snapshot is unknown', () => {
        setRescue(null);
        const { wrapper } = mountBoth();
        expect(wrapper.find('[data-rescue-banner]').text()).not.toContain('#');
    });

    it('hides the details link on the snapshots page', async () => {
        setRescue(145);
        const { wrapper, router } = mountBoth();
        await router.push('/admin/snapshots');
        await wrapper.vm.$nextTick();
        expect(wrapper.find('.rescue-banner__details').exists()).toBe(false);
    });
});

describe('RescueInfoDialog', () => {
    it('opens once per snapshot, then only from the banner link', async () => {
        setRescue(145);
        const first = mountBoth();
        await first.wrapper.vm.$nextTick();
        expect(useRescueStore().infoOpen).toBe(true);
        expect(sessionStorage.getItem('rescue-info-seen')).toBe('145');
        first.wrapper.unmount();

        useRescueStore().infoOpen = false;
        const second = mountBoth();
        await second.wrapper.vm.$nextTick();
        expect(useRescueStore().infoOpen).toBe(false);
        await second.wrapper.find('.rescue-banner__details').trigger('click');
        expect(useRescueStore().infoOpen).toBe(true);
        second.wrapper.unmount();
    });

    it('opens again for another snapshot', async () => {
        sessionStorage.setItem('rescue-info-seen', '145');
        setRescue(150);
        const { wrapper } = mountBoth();
        await wrapper.vm.$nextTick();
        expect(useRescueStore().infoOpen).toBe(true);
        wrapper.unmount();
    });

    it('"Open Snapshots" goes to the snapshots route and closes', async () => {
        setRescue(145);
        const { wrapper, router } = mountBoth();
        await wrapper.vm.$nextTick();
        const open = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('Open Snapshots'));
        expect(open).toBeDefined();
        open?.click();
        await wrapper.vm.$nextTick();
        await new Promise((r) => setTimeout(r, 0));
        expect(router.currentRoute.value.name).toBe('adminSnapshots');
        expect(useRescueStore().infoOpen).toBe(false);
        wrapper.unmount();
    });
});
