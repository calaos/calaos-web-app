import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { messages } from '../../i18n/messages';
import { toServices } from '../../protocol/admin-services';
import { useAdminServicesStore } from '../../stores/adminServices';
import ServicesPanel from './ServicesPanel.vue';

function mountPanel() {
    return mount(ServicesPanel, {
        global: {
            plugins: [createI18n({ legacy: false, locale: 'en', messages })],
            stubs: { Teleport: true },
        },
    });
}

function row(wrapper: ReturnType<typeof mountPanel>, id: string) {
    return wrapper.find(`[data-service="${id}"]`);
}

enableAutoUnmount(afterEach);

beforeEach(() => {
    setActivePinia(createPinia());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('ServicesPanel', () => {
    it('lights each state, and offers no button to status-only or missing units', async () => {
        const wrapper = mountPanel();
        useAdminServicesStore().services = toServices({
            services: [
                { id: 'mosquitto', kind: 'service', restartable: true, active_state: 'active', since: new Date().toISOString() },
                { id: 'grafana', kind: 'service', restartable: true, active_state: 'failed', since: null },
                { id: 'olad', kind: 'service', restartable: true, active_state: 'not-found', since: null },
                { id: 'calaos-ddns', kind: 'oneshot', restartable: true, active_state: 'inactive', since: null },
                { id: 'haproxy', kind: 'service', restartable: false, active_state: 'active', since: null },
            ],
        });
        await flushPromises();

        expect(row(wrapper, 'mosquitto').find('.services__light--active').exists()).toBe(true);
        expect(row(wrapper, 'mosquitto').find('.services__meta').text()).toMatch(/^Running, started/);
        expect(row(wrapper, 'mosquitto').find('button').text()).toBe('Restart');
        expect(row(wrapper, 'grafana').find('.services__light--failed').exists()).toBe(true);
        expect(row(wrapper, 'olad').find('.services__light--not-found').exists()).toBe(true);
        expect(row(wrapper, 'olad').find('button').exists()).toBe(false);
        expect(row(wrapper, 'calaos-ddns').find('button').text()).toBe('Run now');
        expect(row(wrapper, 'haproxy').find('button').exists()).toBe(false);
        expect(row(wrapper, 'haproxy').find('.services__tag').text()).toBe('Status only');
    });

    it('shows a row result and the calaos-server warning in its confirmation', async () => {
        const wrapper = mountPanel();
        const services = useAdminServicesStore();
        services.services = toServices({
            services: [
                { id: 'calaos-server', kind: 'service', restartable: true, active_state: 'active', since: null },
                { id: 'grafana', kind: 'service', restartable: true, active_state: 'failed', since: null },
            ],
        });
        services.results.grafana = { status: 'failed' };
        await flushPromises();
        expect(row(wrapper, 'grafana').find('.services__result--danger').text()).toContain('did not start again');

        await row(wrapper, 'calaos-server').find('button').trigger('click');
        expect(wrapper.find('.services__warning').text()).toContain('about 30 seconds');
    });
});
