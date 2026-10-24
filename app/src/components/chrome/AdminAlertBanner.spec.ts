import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import en from '../../i18n/en.json';
import fr from '../../i18n/fr.json';
import { useAdminAlertsStore } from '../../stores/adminAlerts';
import { useAuthStore } from '../../stores/auth';
import { isolateName } from '../../composables/isolateName';
import AdminAlertBanner from './AdminAlertBanner.vue';

/** U+202E RIGHT-TO-LEFT OVERRIDE: unisolated, it would reverse the rest of the sentence. */
const RTL_NAME = '‮enohp s’luoaR';

function mountBanner() {
    return mount(AdminAlertBanner, {
        global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en, fr } })] },
    });
}

beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    useAuthStore().state = 'authed';
});

function deliver(name: string): void {
    const alerts = useAdminAlertsStore();
    alerts.attachTransport(() => true);
    alerts.refresh();
    alerts.handleEventLog({
        kind: 'eventlog',
        msgId: 'admin_alerts:1',
        data: {
            events: [
                {
                    id: 'e1',
                    event_type: '22',
                    created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
                    event_raw: { message: `New approver phone on your Calaos box: "${name}"` },
                },
            ],
        },
    });
}

describe('AdminAlertBanner', () => {
    it('isolates a name carrying an RTL override in its own <bdi>', async () => {
        deliver(RTL_NAME);
        const wrapper = mountBanner();
        await wrapper.vm.$nextTick();
        const title = wrapper.find('.admin-alert__title');
        const bdi = title.find('bdi');
        expect(bdi.exists()).toBe(true);
        expect(bdi.text()).toBe(RTL_NAME);
        expect(bdi.attributes('title')).toBe(RTL_NAME);
        // The override sits inside the isolate; the sentence around it is plain text.
        expect(title.text().startsWith('New approver phone: “')).toBe(true);
        expect(title.element.childNodes[0].textContent).not.toContain('‮');
    });

    it('hides once dismissed', async () => {
        deliver('Pixel 8');
        const wrapper = mountBanner();
        await wrapper.vm.$nextTick();
        await wrapper.find('.admin-alert__dismiss').trigger('click');
        expect(wrapper.find('.admin-alert').exists()).toBe(false);
    });
});

describe('isolateName', () => {
    it('wraps a name in first-strong isolate marks and caps its length', () => {
        expect(isolateName(RTL_NAME)).toBe(`⁨${RTL_NAME}⁩`);
        const long = 'x'.repeat(40);
        expect(isolateName(long)).toBe(`⁨${'x'.repeat(31)}…⁩`);
    });
});
