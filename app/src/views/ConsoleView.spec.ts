import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory } from 'vue-router';
import ConsoleView from './ConsoleView.vue';
import en from '../i18n/en.json';
import { useAdminStore } from '../stores/admin';
import { useApproversStore } from '../stores/approvers';
import { useAuthStore } from '../stores/auth';
import { createAppRouter } from '../router';

beforeEach(() => {
    setActivePinia(createPinia());
    useAuthStore().state = 'authed';
    const admin = useAdminStore();
    admin.gate = 'unlocked';
    admin.session = 'a'.repeat(64);
    // No approver: the first screen that offers a way back, without a daemon.
    useApproversStore().approvers = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('ConsoleView exit', () => {
    it('Back returns to the System page, not the hub', async () => {
        const router = createAppRouter(createMemoryHistory());
        router.getRoutes().find((r) => r.name === 'adminConsole')!.components!.default = ConsoleView;
        await router.push('/admin/console');
        const wrapper = mount(ConsoleView, {
            global: {
                plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } }), router],
                stubs: { Teleport: true },
            },
        });
        await flushPromises();

        const back = wrapper.findAll('button').find((b) => b.text() === en.admin.console.back);
        expect(back).toBeDefined();
        router.getRoutes().find((r) => r.name === 'adminSystem')!.components!.default = { render: () => null };
        await back!.trigger('click');
        await flushPromises();

        expect(router.currentRoute.value.path).toBe('/admin/system');
    });
});
