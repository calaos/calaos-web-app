import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory } from 'vue-router';
import AdminView from './AdminView.vue';
import en from '../i18n/en.json';
import fr from '../i18n/fr.json';
import { toAdminError } from '../protocol/admin';
import { useAdminStore } from '../stores/admin';
import { useAuthStore } from '../stores/auth';
import { createAppRouter } from '../router';
import type { VueWrapper } from '@vue/test-utils';
import type { Router } from 'vue-router';

const JOB = {
    id: '3f9c',
    kind: 'upgrade_all',
    package: '',
    status: 'running',
    error: '',
    rebootRequired: false,
    daemonRestart: false,
    startedAt: '',
    finishedAt: '',
};

const PROGRESS = {
    status: 'upgrading' as const,
    totalPercent: 0,
    currentPkg: '',
    currentStep: 'install',
    pkgIndex: 1,
    pkgCount: 2,
    message: '',
    error: '',
    packageNames: [],
};

function mountView(locale: 'en' | 'fr' = 'en'): VueWrapper {
    return mount(AdminView, {
        global: {
            plugins: [
                createI18n({ legacy: false, locale, messages: { en, fr } }),
                createAppRouter(createMemoryHistory()),
            ],
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

describe('AdminView bootstrap screen', () => {
    it('says which addresses will be accepted even when api_allowed_hosts is empty', async () => {
        useAdminStore().gate = 'bootstrap';
        const wrapper = mountView();
        await flushPromises();
        expect(wrapper.find('.admin__hosts').text()).toContain(en.admin.bootstrap.allowedHostsNone);
    });

    it('lists the allowed hosts when there are some', async () => {
        const admin = useAdminStore();
        admin.gate = 'bootstrap';
        admin.apiAllowedHosts = 'calaos.example.net';
        const wrapper = mountView('fr');
        await flushPromises();
        const text = wrapper.find('.admin__hosts').text();
        expect(text).toContain(fr.admin.bootstrap.allowedHostsHint.replace('{hosts}', 'calaos.example.net'));
        expect(text).toContain('n’importe quel nom en https');
        expect(text).not.toContain(fr.admin.bootstrap.allowedHostsNone);
    });
});

describe('AdminView hub', () => {
    function unlocked(): ReturnType<typeof useAdminStore> {
        const admin = useAdminStore();
        admin.gate = 'unlocked';
        admin.session = 'a'.repeat(64);
        return admin;
    }

    const tile = (wrapper: VueWrapper, id: string) => wrapper.find(`[data-page="${id}"]`);

    it('is nothing but its tiles, in the order of the brief', async () => {
        unlocked();
        const wrapper = mountView();
        await flushPromises();
        expect(wrapper.findAll('[data-page]').map((node) => node.attributes('data-page'))).toEqual([
            'updates',
            'network',
            'services',
            'logs',
            'time',
            'mcp',
            'security',
            'system',
            'settings',
        ]);
        expect(wrapper.find('.updates').exists()).toBe(false);
        expect(wrapper.find('.mcp').exists()).toBe(false);
        expect(wrapper.find('.approvers').exists()).toBe(false);
    });

    it('keeps a message left by a sub-page until it is dismissed', async () => {
        unlocked().info = 'reboot_sent';
        const wrapper = mountView();
        await flushPromises();
        expect(wrapper.find('.admin__info').text()).toContain(en.admin.info.reboot_sent);
        await wrapper.find('.admin__dismiss').trigger('click');
        expect(wrapper.find('.admin__info').exists()).toBe(false);
    });

    it('invites to look for updates before anything is known', async () => {
        unlocked();
        const wrapper = mountView();
        await flushPromises();
        const updates = tile(wrapper, 'updates');
        expect(updates.text()).toContain(en.admin.updates.entryHint);
        expect(updates.classes()).not.toContain('pages__tile--warn');
    });

    it('says the box is up to date, quietly', async () => {
        unlocked().updates = [];
        const wrapper = mountView();
        await flushPromises();
        const updates = tile(wrapper, 'updates');
        expect(updates.text()).toContain(en.admin.updates.upToDate);
        expect(updates.classes()).not.toContain('pages__tile--warn');
    });

    it('flags the updates that wait', async () => {
        unlocked().updates = [{ name: 'calaos-server', current: '1', available: '2' }] as never;
        const wrapper = mountView();
        await flushPromises();
        const updates = tile(wrapper, 'updates');
        expect(updates.text()).toContain('1 update available');
        expect(updates.classes()).toContain('pages__tile--warn');
    });

    it('follows a run in progress', async () => {
        const admin = unlocked();
        admin.job = { ...JOB, status: 'running' };
        admin.progress = { ...PROGRESS, totalPercent: 40 };
        const wrapper = mountView();
        await flushPromises();
        const updates = tile(wrapper, 'updates');
        expect(updates.text()).toContain(en.admin.updates.upgrading.replace('{percent}', '40'));
        expect(updates.classes()).toContain('pages__tile--warn');
    });

    it('flags a failed run', async () => {
        unlocked().job = { ...JOB, status: 'error', finishedAt: new Date().toISOString() };
        const wrapper = mountView();
        await flushPromises();
        const updates = tile(wrapper, 'updates');
        expect(updates.text()).toContain(en.admin.updates.failed);
        expect(updates.classes()).toContain('pages__tile--warn');
    });

    it('tells a refused status read on the tile', async () => {
        const admin = unlocked();
        admin.notice = toAdminError({ error: 'package_held', msg: 'calaos-server is held' });
        admin.noticeSource = 'updates';
        const wrapper = mountView();
        await flushPromises();
        const updates = tile(wrapper, 'updates');
        expect(updates.text()).toContain(en.admin.error.package_held);
        expect(updates.classes()).toContain('pages__tile--warn');
    });
});

describe('AdminView with ?add=phone', () => {
    async function mountAt(unlockedBox: boolean): Promise<{ wrapper: VueWrapper; router: Router }> {
        const router = createAppRouter(createMemoryHistory());
        // The hub is the view under test: the security page would need the whole store.
        router.getRoutes().find((r) => r.name === 'adminSecurity')!.components!.default = { render: () => null };
        const admin = useAdminStore();
        admin.gate = unlockedBox ? 'unlocked' : 'locked';
        admin.session = unlockedBox ? 'a'.repeat(64) : null;
        await router.push({ name: 'admin', query: { add: 'phone' } });
        const wrapper = mount(AdminView, {
            global: {
                plugins: [createI18n({ legacy: false, locale: 'en', messages: { en, fr } }), router],
                stubs: { Teleport: true },
            },
        });
        await flushPromises();
        return { wrapper, router };
    }

    it('goes straight to the security page, query kept, when unlocked', async () => {
        const { router } = await mountAt(true);
        expect(router.currentRoute.value.name).toBe('adminSecurity');
        expect(router.currentRoute.value.query.add).toBe('phone');
    });

    it('waits for the unlock', async () => {
        const { wrapper, router } = await mountAt(false);
        expect(router.currentRoute.value.name).toBe('admin');
        expect(wrapper.find('.admin-password').exists()).toBe(true);
        const admin = useAdminStore();
        admin.session = 'a'.repeat(64);
        admin.gate = 'unlocked';
        await flushPromises();
        expect(router.currentRoute.value.name).toBe('adminSecurity');
        expect(router.currentRoute.value.query.add).toBe('phone');
    });
});
