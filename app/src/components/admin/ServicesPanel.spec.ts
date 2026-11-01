import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { messages } from '../../i18n/messages';
import type { UpgradeJob } from '../../protocol/admin';
import { toServices } from '../../protocol/admin-services';
import { useAdminStore } from '../../stores/admin';
import { useAdminServicesStore } from '../../stores/adminServices';
import ServicesPanel from './ServicesPanel.vue';

const ALL = ['restart', 'start', 'stop', 'enable', 'disable'];
const UPGRADE_JOB: UpgradeJob = {
    id: 'j1',
    kind: 'upgrade_all',
    package: '',
    status: 'running',
    error: '',
    rebootRequired: false,
    daemonRestart: false,
    startedAt: '',
    finishedAt: '',
};

function mountPanel() {
    return mount(ServicesPanel, {
        global: {
            plugins: [createI18n({ legacy: false, locale: 'en', messages })],
            stubs: { Teleport: true, RouterLink: { template: '<a class="stub-link"><slot /></a>' } },
        },
    });
}

function row(wrapper: ReturnType<typeof mountPanel>, id: string) {
    return wrapper.find(`[data-service="${id}"]`);
}

function labels(wrapper: ReturnType<typeof mountPanel>, id: string): string[] {
    return row(wrapper, id)
        .findAll('button:not([role="switch"])')
        .map((button) => button.text());
}

function clickLabel(wrapper: ReturnType<typeof mountPanel>, id: string, label: string) {
    const button = row(wrapper, id)
        .findAll('button')
        .find((candidate) => candidate.text() === label);
    if (button === undefined) throw new Error(`no ${label} on ${id}`);
    return button.trigger('click');
}

function show(...rows: Record<string, unknown>[]): ReturnType<typeof useAdminServicesStore> {
    const services = useAdminServicesStore();
    services.services = toServices({ services: rows });
    return services;
}

function service(id: string, active_state = 'active', startup = 'enabled', actions = ALL, since: string | null = null) {
    return { id, actions, active_state, startup, since };
}

enableAutoUnmount(afterEach);

beforeEach(() => {
    setActivePinia(createPinia());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('ServicesPanel', () => {
    it('offers the verbs of each state, and nothing on what it cannot act on', async () => {
        const wrapper = mountPanel();
        show(
            service('mosquitto', 'active', 'enabled', ALL, new Date(Date.now() - 2 * 3_600_000).toISOString()),
            service('grafana', 'failed'),
            service('envoy', 'inactive', 'disabled'),
            service('calaos-server', 'active', 'enabled', ['restart']),
            service('calaos-container', 'inactive', 'enabled', ['restart']),
            service('olad', 'not-found', ''),
            service('hue2mqtt', 'inactive', 'masked'),
            service('networkd', 'active', 'static', []),
        );
        await flushPromises();

        expect(row(wrapper, 'mosquitto').find('.services__light--active').exists()).toBe(true);
        expect(row(wrapper, 'mosquitto').find('.services__meta').text()).toBe('Running since 2h');
        expect(labels(wrapper, 'mosquitto')).toEqual(['Restart', 'Stop']);
        expect(row(wrapper, 'grafana').find('.services__light--failed').exists()).toBe(true);
        expect(labels(wrapper, 'grafana')).toEqual(['Start']);
        expect(labels(wrapper, 'envoy')).toEqual(['Start']);
        expect(labels(wrapper, 'calaos-server')).toEqual(['Restart']);
        expect(labels(wrapper, 'calaos-container')).toEqual(['Restart']);

        expect(row(wrapper, 'olad').find('.services__light--not-found').exists()).toBe(true);
        expect(row(wrapper, 'olad').find('button').exists()).toBe(false);
        expect(row(wrapper, 'olad').find('.services__tag').exists()).toBe(false);
        expect(row(wrapper, 'hue2mqtt').find('.services__meta').text()).toBe('Masked (SSH)');
        expect(row(wrapper, 'hue2mqtt').find('.services__light--not-found').exists()).toBe(true);
        expect(row(wrapper, 'hue2mqtt').find('button').exists()).toBe(false);
        expect(row(wrapper, 'networkd').find('button').exists()).toBe(false);
        expect(row(wrapper, 'networkd').find('.services__tag').text()).toBe('Status only');
    });

    it('shows the boot switch where it means something, and a link for the time service', async () => {
        const wrapper = mountPanel();
        show(
            service('mosquitto'),
            service('envoy', 'inactive', 'disabled'),
            service('calaos-home', 'active', 'static'),
            service('hue2mqtt', 'inactive', 'masked'),
            service('ssh', 'active', 'enabled', ['restart']),
            service('ntp', 'active', 'enabled', ['restart']),
        );
        await flushPromises();

        const on = row(wrapper, 'mosquitto').find('[role="switch"]');
        expect(on.attributes('aria-checked')).toBe('true');
        expect(on.attributes('aria-label')).toBe('Start at boot: Mosquitto (MQTT)');
        expect(row(wrapper, 'envoy').find('[role="switch"]').attributes('aria-checked')).toBe('false');
        for (const id of ['calaos-home', 'hue2mqtt', 'ssh', 'ntp']) {
            expect(row(wrapper, id).find('[role="switch"]').exists()).toBe(false);
        }
        expect(row(wrapper, 'ntp').find('.stub-link').text()).toBe('On/off: Date and time');
        expect(labels(wrapper, 'ntp')).toEqual(['Restart']);
    });

    it('starts and enables without asking', async () => {
        const wrapper = mountPanel();
        const services = show(service('envoy', 'inactive', 'disabled'), service('grafana', 'inactive', 'disabled'));
        const act = vi.spyOn(services, 'actAndWatch').mockResolvedValue();
        await flushPromises();

        await clickLabel(wrapper, 'envoy', 'Start');
        await row(wrapper, 'grafana').find('[role="switch"]').trigger('click');
        expect(act.mock.calls).toEqual([
            ['envoy', 'start'],
            ['grafana', 'enable'],
        ]);
        expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    });

    it('asks before a stop, with its consequence, in a danger dialog', async () => {
        const wrapper = mountPanel();
        const services = show(service('mosquitto'));
        const act = vi.spyOn(services, 'actAndWatch').mockResolvedValue();
        await flushPromises();

        await clickLabel(wrapper, 'mosquitto', 'Stop');
        const dialog = wrapper.find('[role="dialog"]');
        expect(dialog.text()).toContain('Stop Mosquitto (MQTT)?');
        expect(dialog.find('.services__consequence').text()).toContain('Zigbee, Hue, Enphase and MQTT devices');
        expect(dialog.text()).toContain('turn off Start at boot');
        expect(dialog.find('.base-dialog__button--danger').text()).toBe('Stop');
        expect(act).not.toHaveBeenCalled();

        await dialog.find('form').trigger('submit');
        expect(act).toHaveBeenCalledWith('mosquitto', 'stop');
    });

    it('asks before turning off at boot', async () => {
        const wrapper = mountPanel();
        const services = show(service('influxdb'));
        const act = vi.spyOn(services, 'actAndWatch').mockResolvedValue();
        await flushPromises();

        await row(wrapper, 'influxdb').find('[role="switch"]').trigger('click');
        const dialog = wrapper.find('[role="dialog"]');
        expect(dialog.text()).toContain('Stop InfluxDB now and at every boot?');
        expect(dialog.find('.services__consequence').exists()).toBe(true);
        await dialog.find('form').trigger('submit');
        expect(act).toHaveBeenCalledWith('influxdb', 'disable');
    });

    it.each([
        ['calaos-server', 'about 30 seconds'],
        ['haproxy', 'reconnects by itself'],
        ['calaos-container', 'Admin features are unavailable'],
    ])('warns before restarting %s, what carries the page', async (id, text) => {
        const wrapper = mountPanel();
        show(service(id, 'active', 'enabled', ['restart']));
        await flushPromises();
        await clickLabel(wrapper, id, 'Restart');
        expect(wrapper.find('.services__warning').text()).toContain(text);
        expect(wrapper.find('.base-dialog__button--danger').exists()).toBe(false);
    });

    it('asks no warning of a plain restart', async () => {
        const wrapper = mountPanel();
        show(service('grafana'));
        await flushPromises();
        await clickLabel(wrapper, 'grafana', 'Restart');
        expect(wrapper.find('.services__warning').exists()).toBe(false);
    });

    it('shows one busy control while a verb runs, and the switch waits', async () => {
        const wrapper = mountPanel();
        const services = show(service('mosquitto'));
        services.tracked.mosquitto = { phase: 'waiting', verb: 'stop', before: '', stillFailed: false, deadline: 0 };
        await flushPromises();

        expect(labels(wrapper, 'mosquitto')).toEqual(['Stopping…']);
        expect(row(wrapper, 'mosquitto').find('.services__light--working').exists()).toBe(true);
        const toggle = row(wrapper, 'mosquitto').find('[role="switch"]');
        expect(toggle.attributes('disabled')).toBeDefined();
        expect(toggle.attributes('aria-busy')).toBe('true');
    });

    it('names what is restarting in the banner', async () => {
        const wrapper = mountPanel();
        const services = show(service('haproxy', 'active', 'enabled', ['restart']));
        services.tracked.haproxy = { phase: 'reconnecting', verb: 'restart', before: '', stillFailed: false, deadline: 0 };
        await flushPromises();
        expect(wrapper.find('.services__banner').text()).toContain('haproxy is restarting');
        expect(labels(wrapper, 'haproxy')).toEqual(['Reconnecting…']);
    });

    it('disables every control during an update', async () => {
        const wrapper = mountPanel();
        show(service('mosquitto'));
        vi.spyOn(useAdminStore(), 'isUpgrading', 'get').mockReturnValue(true);
        await flushPromises();
        await wrapper.vm.$forceUpdate();
        await flushPromises();
        for (const control of row(wrapper, 'mosquitto').findAll('button')) {
            expect(control.attributes('disabled')).toBeDefined();
        }
    });

    it('closes an open dialog when an update starts', async () => {
        const wrapper = mountPanel();
        show(service('mosquitto'));
        await flushPromises();
        await clickLabel(wrapper, 'mosquitto', 'Stop');
        expect(wrapper.find('[role="dialog"]').exists()).toBe(true);

        useAdminStore().job = UPGRADE_JOB;
        await flushPromises();
        expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    });

    it('writes each result by verb, and notes a start that will not last', async () => {
        const wrapper = mountPanel();
        const services = show(
            service('grafana', 'failed'),
            service('envoy', 'active', 'disabled'),
            service('mosquitto', 'active', 'enabled'),
            service('influxdb', 'inactive'),
        );
        services.results.grafana = { verb: 'start', status: 'failed' };
        services.results.envoy = { verb: 'start', status: 'done' };
        services.results.mosquitto = { verb: 'start', status: 'done' };
        services.results.influxdb = { verb: 'stop', status: 'timeout' };
        await flushPromises();

        expect(row(wrapper, 'grafana').find('.services__result--danger').text()).toBe('It did not start. Its logs tell why.');
        expect(row(wrapper, 'envoy').find('.services__result--ok').text()).toBe('Started.');
        expect(row(wrapper, 'envoy').find('.services__note').text()).toContain('will not start again');
        expect(row(wrapper, 'mosquitto').find('.services__note').exists()).toBe(false);
        expect(row(wrapper, 'influxdb').find('.services__result--warn').text()).toContain('60 seconds');
    });
});
