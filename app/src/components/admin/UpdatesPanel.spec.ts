import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory } from 'vue-router';
import UpdatesPanel from './UpdatesPanel.vue';
import en from '../../i18n/en.json';
import fr from '../../i18n/fr.json';
import { toAdminError } from '../../protocol/admin';
import { createAppRouter } from '../../router';
import { useAdminStore } from '../../stores/admin';
import { useAuthStore } from '../../stores/auth';
import type { VueWrapper } from '@vue/test-utils';

function mountPanel(locale: 'en' | 'fr' = 'en'): VueWrapper {
    return mount(UpdatesPanel, {
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

describe('UpdatesPanel errors', () => {
    it.each([
        ['en', en.admin.error.package_held],
        ['fr', fr.admin.error.package_held],
    ] as const)('says a held package will not be updated (%s)', async (locale, sentence) => {
        const admin = useAdminStore();
        admin.gate = 'unlocked';
        admin.session = 'a'.repeat(64);
        admin.notice = toAdminError({ error: 'package_held', msg: 'calaos-server is held' });
        admin.noticeSource = 'updates';
        const wrapper = mountPanel(locale);
        await flushPromises();
        expect(wrapper.find('.updates__error').text()).toBe(sentence);
    });
});

describe('UpdatesPanel while an upgrade runs', () => {
    function upgrading(currentPkg: string): void {
        const admin = useAdminStore();
        admin.gate = 'unlocked';
        admin.session = 'a'.repeat(64);
        admin.job = {
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
        admin.progress = {
            status: 'upgrading',
            totalPercent: 40,
            currentPkg,
            currentStep: 'install',
            pkgIndex: 2,
            pkgCount: 3,
            message: '',
            error: '',
            packageNames: [],
        };
    }

    it('names the package from the full view', async () => {
        upgrading('calaos-server');
        const wrapper = mountPanel();
        await flushPromises();
        expect(wrapper.find('.updates__package').text()).toBe('calaos-server (2 of 3)');
    });

    it('counts packages without naming them in the household view', async () => {
        upgrading('');
        const wrapper = mountPanel();
        await flushPromises();
        expect(wrapper.find('.updates__package').text()).toBe('Package 2 of 3');
    });
});

describe('UpdatesPanel after a failed run', () => {
    function failed(error: string): void {
        const admin = useAdminStore();
        admin.gate = 'unlocked';
        admin.session = 'a'.repeat(64);
        admin.job = {
            id: '3f9c',
            kind: 'upgrade_all',
            package: '',
            status: 'error',
            error,
            rebootRequired: false,
            daemonRestart: false,
            startedAt: '',
            finishedAt: new Date().toISOString(),
        };
    }

    it('gives the daemon reason from the full view', async () => {
        failed('apt-get returned 100');
        const wrapper = mountPanel();
        await flushPromises();
        expect(wrapper.find('.updates__hint').text()).toBe('Reason: apt-get returned 100');
    });

    it('does not echo the generic household error as a reason', async () => {
        failed('upgrade failed');
        const wrapper = mountPanel();
        await flushPromises();
        expect(wrapper.find('.updates__hint').text()).toBe(en.admin.updates.failedHint);
    });

    it('says an interrupted run was interrupted', async () => {
        failed('interrupted');
        const wrapper = mountPanel('fr');
        await flushPromises();
        expect(wrapper.find('.updates__hint').text()).toBe(fr.admin.updates.failedInterrupted);
    });
});

describe('UpdatesPanel after a run that needs a restart', () => {
    function needsRestart(): ReturnType<typeof useAdminStore> {
        const admin = useAdminStore();
        admin.gate = 'unlocked';
        admin.session = 'a'.repeat(64);
        admin.job = {
            id: '3f9c',
            kind: 'upgrade_all',
            package: '',
            status: 'done',
            error: '',
            rebootRequired: true,
            daemonRestart: false,
            startedAt: '',
            finishedAt: new Date().toISOString(),
        };
        return admin;
    }

    it('asks once, then restarts', async () => {
        const admin = needsRestart();
        const reboot = vi.spyOn(admin, 'reboot').mockResolvedValue();
        const wrapper = mountPanel();
        await flushPromises();
        await wrapper.find('.updates__actions button').trigger('click');
        expect(reboot).not.toHaveBeenCalled();
        await wrapper.find('[role="dialog"] form').trigger('submit');
        expect(reboot).toHaveBeenCalledOnce();
    });

    it('says here why the restart was refused', async () => {
        const admin = needsRestart();
        admin.notice = toAdminError({ error: 'internal', msg: 'nope' });
        admin.noticeSource = 'box';
        const wrapper = mountPanel();
        await flushPromises();
        expect(wrapper.find('.updates__error').text()).toBe(en.admin.error.internal);
    });

    it('leaves the unlock form its own refusals', async () => {
        const admin = needsRestart();
        admin.notice = toAdminError({ error: 'bad_password', msg: 'nope' });
        admin.noticeSource = 'gate';
        const wrapper = mountPanel();
        await flushPromises();
        expect(wrapper.find('.updates__error').exists()).toBe(false);
    });
});
