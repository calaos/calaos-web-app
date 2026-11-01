import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { VueWrapper } from '@vue/test-utils';
import type { Router } from 'vue-router';
import { toAdminError } from '../protocol/admin';
import { useAdminStore } from '../stores/admin';
import { useAdminSubPage } from './useAdminSubPage';

async function open(holding?: () => boolean): Promise<{ wrapper: VueWrapper; router: Router }> {
    const blank = { render: () => null };
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/admin', name: 'admin', component: blank },
            { path: '/admin/page', name: 'page', component: blank },
        ],
    });
    await router.push({ name: 'page' });
    const Page = defineComponent({
        setup() {
            const { shown } = useAdminSubPage(holding);
            return () => h('p', shown.value ? 'shown' : 'gone');
        },
    });
    const wrapper = mount(Page, { global: { plugins: [router] } });
    await flushPromises();
    return { wrapper, router };
}

function unlocked(): ReturnType<typeof useAdminStore> {
    const admin = useAdminStore();
    admin.session = 'a'.repeat(64);
    admin.gate = 'unlocked';
    return admin;
}

beforeEach(() => {
    setActivePinia(createPinia());
});

describe('useAdminSubPage', () => {
    it('watches the box while the page is up, and stops with it', async () => {
        const admin = unlocked();
        const activate = vi.spyOn(admin, 'activate').mockImplementation(() => {});
        const suspend = vi.spyOn(admin, 'suspend');
        const deactivate = vi.spyOn(admin, 'deactivate');
        const { wrapper } = await open();
        expect(activate).toHaveBeenCalledOnce();
        expect(suspend).not.toHaveBeenCalled();
        wrapper.unmount();
        expect(suspend).toHaveBeenCalledOnce();
        expect(deactivate).not.toHaveBeenCalled();
    });

    it('sends a locked visitor back to the hub, without watching anything', async () => {
        const admin = useAdminStore();
        const activate = vi.spyOn(admin, 'activate').mockImplementation(() => {});
        const { wrapper, router } = await open();
        expect(router.currentRoute.value.name).toBe('admin');
        expect(wrapper.text()).toBe('gone');
        expect(activate).not.toHaveBeenCalled();
    });

    it('goes back to the hub when the session ends', async () => {
        const admin = unlocked();
        vi.spyOn(admin, 'activate').mockImplementation(() => {});
        const { wrapper, router } = await open();
        expect(wrapper.text()).toBe('shown');
        admin.session = null;
        admin.gate = 'locked';
        await flushPromises();
        expect(router.currentRoute.value.name).toBe('admin');
    });

    it('holds on while the page says so', async () => {
        const admin = unlocked();
        vi.spyOn(admin, 'activate').mockImplementation(() => {});
        const swapping = ref(true);
        const { wrapper, router } = await open(() => swapping.value);
        admin.session = null;
        admin.gate = 'locked';
        await flushPromises();
        expect(router.currentRoute.value.name).toBe('page');
        expect(wrapper.text()).toBe('shown');

        swapping.value = false;
        await flushPromises();
        expect(router.currentRoute.value.name).toBe('admin');
    });

    it('leaves the message for the hub', async () => {
        const admin = unlocked();
        vi.spyOn(admin, 'activate').mockImplementation(() => {});
        const { wrapper } = await open();
        admin.info = 'reboot_sent';
        wrapper.unmount();
        expect(admin.info).toBe('reboot_sent');
    });

    it('takes a refusal away with the page', async () => {
        const admin = unlocked();
        vi.spyOn(admin, 'activate').mockImplementation(() => {});
        const { wrapper } = await open();
        admin.notice = toAdminError({ error: 'internal', msg: 'nope' });
        admin.noticeSource = 'box';
        wrapper.unmount();
        expect(admin.notice).toBeNull();
    });

    it('leaves the password form its refusal', async () => {
        const admin = unlocked();
        vi.spyOn(admin, 'activate').mockImplementation(() => {});
        const { wrapper } = await open();
        admin.notice = toAdminError({ error: 'bad_password', msg: 'nope' });
        admin.noticeSource = 'gate';
        wrapper.unmount();
        expect(admin.notice).not.toBeNull();
    });
});
