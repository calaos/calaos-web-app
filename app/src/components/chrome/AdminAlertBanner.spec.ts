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
const RTL_NAME = '\u202Eenohp s’luoaR';

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
        msgId: 'admin_alerts:1:0',
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
        expect(title.text()).toBe(`New approver phone: “${RTL_NAME}”`);
        expect(title.element.childNodes[0].textContent).not.toContain('\u202E');
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
        // The override is dropped, and a stray PDI cannot close the isolate early.
        expect(isolateName(RTL_NAME)).toBe('\u2068enohp s’luoaR\u2069');
        expect(isolateName('x\u2069\u202Eevil')).toBe('\u2068xevil\u2069');
        const long = 'x'.repeat(40);
        expect(isolateName(long)).toBe(`\u2068${'x'.repeat(31)}…\u2069`);
    });
});
