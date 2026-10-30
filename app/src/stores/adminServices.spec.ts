import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminStore } from './admin';
import { useAuthStore } from './auth';
import { useConnectionStore } from './connection';
import { RESTART_DEADLINE_MS, RESTART_POLL_MS, useAdminServicesStore } from './adminServices';
import type { ServiceVerb } from '../protocol/admin-services';
import { SESSION, fail, flush, harness, last, ok, setUp, unlocked } from './adminTestHarness';

const BEFORE = '2026-10-22T08:00:00Z';
const AFTER = '2026-10-25T10:00:00Z';

const ALL_VERBS = ['restart', 'start', 'stop', 'enable', 'disable'];

function unit(id: string, active_state: string, since: string | null = BEFORE, startup = 'enabled') {
    return { id, unit: `${id}.service`, actions: ALL_VERBS, active_state, sub_state: '', startup, since };
}

function online(): void {
    useConnectionStore().applyStatus({ status: 'open', attempt: 0, nextRetryMs: 0 });
    useAuthStore().$patch({ state: 'authed' });
}

async function listed(...units: ReturnType<typeof unit>[]): Promise<ReturnType<typeof useAdminServicesStore>> {
    const services = useAdminServicesStore();
    void services.load();
    ok({ services: units });
    await flush();
    return services;
}

/** Answers the next poll with this list. */
async function poll(...units: ReturnType<typeof unit>[]): Promise<void> {
    vi.advanceTimersByTime(RESTART_POLL_MS);
    expect(last().data.action).toBe('services_list');
    ok({ services: units });
    await flush();
}

/** Answers the next poll with this error. */
async function pollFails(code = 'daemon_unreachable'): Promise<void> {
    vi.advanceTimersByTime(RESTART_POLL_MS);
    expect(last().data.action).toBe('services_list');
    fail(code);
    await flush();
}

async function accepted(
    services: ReturnType<typeof useAdminServicesStore>,
    id: string,
    verb: ServiceVerb = 'restart',
): Promise<void> {
    void services.actAndWatch(id, verb);
    expect(last().data.action).toBe(`services_${verb}`);
    expect(last().data.params).toEqual({ unit: id });
    ok({ id, state: 'accepted' });
    await flush();
}

beforeEach(async () => {
    setUp();
    await unlocked();
    online();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('services store', () => {
    it('lists, and restarts by id', async () => {
        const services = useAdminServicesStore();
        void services.load();
        expect(last().data).toEqual({ action: 'services_list', admin_session: SESSION });
        ok({ services: [{ id: 'mosquitto', actions: ALL_VERBS, active_state: 'active' }] });
        await flush();
        expect(services.services?.[0]).toMatchObject({ id: 'mosquitto', activeState: 'active' });

        const pending = services.restart('mosquitto');
        expect(last().data.params).toEqual({ unit: 'mosquitto' });
        ok({ id: 'mosquitto', state: 'restarting' });
        expect(await pending).toEqual({ outcome: 'restarting', error: null });
    });

    it('takes a drop right after restarting calaos-server as the restart working', async () => {
        const services = useAdminServicesStore();
        const pending = services.restart('calaos-server');
        useAdminStore().handleTransportLost();
        expect(await pending).toEqual({ outcome: 'self_restarting', error: null });
        expect(services.isSelfRestartDrop()).toBe(true);
        vi.advanceTimersByTime(16_000);
        expect(services.isSelfRestartDrop()).toBe(false);
    });

    it('is done only once `since` moved: `active` alone may still be the old process', async () => {
        const services = await listed(unit('mosquitto', 'active'));
        await accepted(services, 'mosquitto');
        expect(services.tracked.mosquitto?.phase).toBe('waiting');

        await poll(unit('mosquitto', 'active'));
        expect(services.results.mosquitto).toBeUndefined();
        await poll(unit('mosquitto', 'activating'));
        await poll(unit('mosquitto', 'active', AFTER));
        expect(services.results.mosquitto).toEqual({ verb: 'restart', status: 'done' });
        expect(services.working).toBe(false);
    });

    it('reports failed, not installed, and the deadline', async () => {
        const services = await listed(unit('grafana', 'active'), unit('envoy', 'active'), unit('influxdb', 'active'));
        await accepted(services, 'grafana');
        await accepted(services, 'envoy');
        await accepted(services, 'influxdb');
        await poll(unit('grafana', 'failed'), unit('envoy', 'not-found', null), unit('influxdb', 'active'));
        expect(services.results.grafana).toEqual({ verb: 'restart', status: 'failed' });
        expect(services.results.envoy).toEqual({ verb: 'restart', status: 'not_found' });
        expect(services.results.influxdb).toBeUndefined();

        for (let waited = RESTART_POLL_MS; waited < RESTART_DEADLINE_MS; waited += RESTART_POLL_MS) {
            await poll(unit('influxdb', 'active'));
        }
        expect(services.results.influxdb).toEqual({ verb: 'restart', status: 'timeout' });
    });

    it('a stop waits for `inactive`, a start for `active`', async () => {
        const services = await listed(unit('mosquitto', 'active'), unit('grafana', 'inactive'));
        await accepted(services, 'mosquitto', 'stop');
        await accepted(services, 'grafana', 'start');
        await poll(unit('mosquitto', 'active'), unit('grafana', 'inactive'));
        expect(services.results).toEqual({});
        await poll(unit('mosquitto', 'deactivating'), unit('grafana', 'activating'));
        expect(services.results).toEqual({});
        await poll(unit('mosquitto', 'inactive'), unit('grafana', 'active'));
        expect(services.results.mosquitto).toEqual({ verb: 'stop', status: 'done' });
        expect(services.results.grafana).toEqual({ verb: 'start', status: 'done' });
    });

    it('enable and disable also wait for `startup`', async () => {
        const services = await listed(unit('mosquitto', 'inactive', BEFORE, 'disabled'), unit('grafana', 'active'));
        await accepted(services, 'mosquitto', 'enable');
        await accepted(services, 'grafana', 'disable');
        await poll(unit('mosquitto', 'active', AFTER, 'disabled'), unit('grafana', 'inactive', BEFORE, 'enabled'));
        expect(services.results).toEqual({});
        await poll(unit('mosquitto', 'active', AFTER, 'enabled'), unit('grafana', 'inactive', BEFORE, 'disabled'));
        expect(services.results.mosquitto).toEqual({ verb: 'enable', status: 'done' });
        expect(services.results.grafana).toEqual({ verb: 'disable', status: 'done' });
    });

    it('a reloaded ssh is done without `since` moving', async () => {
        const services = await listed(unit('ssh', 'active'));
        await accepted(services, 'ssh');
        await poll(unit('ssh', 'active'));
        expect(services.results.ssh).toEqual({ verb: 'restart', status: 'done' });
    });

    it('reports a failed stop, and rereads the list after service_unavailable', async () => {
        const services = await listed(unit('envoy', 'active'), unit('grafana', 'active'));
        await accepted(services, 'grafana', 'stop');
        await poll(unit('envoy', 'active'), unit('grafana', 'failed'));
        expect(services.results.grafana).toEqual({ verb: 'stop', status: 'failed' });

        void services.actAndWatch('envoy', 'start');
        fail('service_unavailable');
        await flush();
        expect(services.results.envoy).toMatchObject({ verb: 'start', status: 'error', error: { code: 'service_unavailable' } });
        expect(services.working).toBe(false);
        expect(last().data.action).toBe('services_list');
    });

    it('stops a `failed` unit without its state ever leaving `failed`', async () => {
        const services = await listed(unit('zigbee2mqtt', 'failed'), unit('envoy', 'failed'));
        await accepted(services, 'zigbee2mqtt', 'disable');
        await accepted(services, 'envoy', 'stop');
        await poll(unit('zigbee2mqtt', 'failed'), unit('envoy', 'failed'));
        expect(services.results.envoy).toEqual({ verb: 'stop', status: 'done' });
        expect(services.results.zigbee2mqtt).toBeUndefined();
        await poll(unit('zigbee2mqtt', 'failed', BEFORE, 'disabled'), unit('envoy', 'failed'));
        expect(services.results.zigbee2mqtt).toEqual({ verb: 'disable', status: 'done' });
    });

    it('gives a `failed` unit it was asked to start the time to leave that state', async () => {
        const services = await listed(unit('grafana', 'failed'), unit('envoy', 'failed'), unit('influxdb', 'failed'));
        await accepted(services, 'grafana', 'start');
        await accepted(services, 'envoy', 'start');
        await accepted(services, 'influxdb', 'restart');
        await poll(unit('grafana', 'failed'), unit('envoy', 'failed'), unit('influxdb', 'failed'));
        expect(services.results).toEqual({});
        await poll(unit('grafana', 'active'), unit('envoy', 'activating'), unit('influxdb', 'failed', AFTER));
        expect(services.results.grafana).toEqual({ verb: 'start', status: 'done' });
        expect(services.results.envoy).toBeUndefined();
        expect(services.results.influxdb).toEqual({ verb: 'restart', status: 'failed' });
        await poll(unit('envoy', 'failed'));
        expect(services.results.envoy).toEqual({ verb: 'start', status: 'failed' });
    });

    it('still reports a disable that fails on a unit that was running', async () => {
        const services = await listed(unit('mosquitto', 'active'));
        await accepted(services, 'mosquitto', 'disable');
        await poll(unit('mosquitto', 'failed', BEFORE, 'disabled'));
        expect(services.results.mosquitto).toEqual({ verb: 'disable', status: 'failed' });
    });

    it('takes a drop after restarting haproxy as the restart working, and names it', async () => {
        const services = await listed(unit('haproxy', 'active'));
        await accepted(services, 'haproxy');
        expect(services.selfId).toBe('haproxy');
        useConnectionStore().applyStatus({ status: 'reconnecting', attempt: 1, nextRetryMs: 1000 });
        await flush();
        expect(services.selfPhase).toBe('reconnecting');
    });

    it('only a restart of what carries the socket counts as a self restart', async () => {
        const services = await listed(unit('mosquitto', 'active'));
        await accepted(services, 'mosquitto');
        expect(services.selfId).toBeNull();
        expect(services.selfRestartAt).toBeNull();
    });

    it('rides out the daemon restarting: the gate stays and the polls go on', async () => {
        const services = await listed(unit('calaos-container', 'active'));
        await accepted(services, 'calaos-container');
        vi.advanceTimersByTime(RESTART_POLL_MS);
        fail('daemon_unreachable');
        await flush();
        expect(useAdminStore().gate).toBe('unlocked');
        expect(services.working).toBe(true);
        await poll(unit('calaos-container', 'active', AFTER));
        expect(services.results['calaos-container']).toEqual({ verb: 'restart', status: 'done' });
    });

    it('ends at the deadline when the daemon never comes back', async () => {
        const services = await listed(unit('calaos-container', 'active'), unit('ssh', 'active'));
        await accepted(services, 'calaos-container');
        await accepted(services, 'ssh');
        for (let waited = RESTART_POLL_MS; waited < RESTART_DEADLINE_MS; waited += RESTART_POLL_MS) {
            await pollFails();
            // The last list predates the verb: it proves nothing, least of all a reload.
            expect(services.results).toEqual({});
        }
        await pollFails();
        expect(services.results['calaos-container']).toEqual({ verb: 'restart', status: 'timeout' });
        expect(services.results.ssh).toEqual({ verb: 'restart', status: 'timeout' });
        expect(services.working).toBe(false);
        expect(useAdminStore().gate).toBe('unlocked');
    });

    it('does not read the outcome off the old list while offline', async () => {
        const services = await listed(unit('ssh', 'active'));
        await accepted(services, 'ssh');
        useConnectionStore().applyStatus({ status: 'reconnecting', attempt: 1, nextRetryMs: 1000 });
        await flush();
        vi.advanceTimersByTime(RESTART_POLL_MS);
        await flush();
        expect(services.results.ssh).toBeUndefined();
        vi.advanceTimersByTime(RESTART_DEADLINE_MS);
        await flush();
        expect(services.results.ssh).toEqual({ verb: 'restart', status: 'timeout' });
    });

    it('frees the row when the network job refuses the daemon restart', async () => {
        const services = await listed(unit('calaos-container', 'active'));
        void services.actAndWatch('calaos-container', 'restart');
        fail('network_pending');
        await flush();
        expect(services.results['calaos-container']).toMatchObject({ status: 'error', error: { code: 'network_pending' } });
        expect(services.working).toBe(false);
    });

    it('follows a restart whose reply timed out: the daemon may still run it', async () => {
        const services = await listed(unit('mosquitto', 'active'));
        void services.actAndWatch('mosquitto', 'restart');
        vi.advanceTimersByTime(5_100);
        await flush();
        expect(services.results.mosquitto).toBeUndefined();
        expect(services.tracked.mosquitto?.phase).toBe('waiting');
        await poll(unit('mosquitto', 'active', AFTER));
        expect(services.results.mosquitto).toEqual({ verb: 'restart', status: 'done' });
    });

    it('shows the 409 of a running upgrade as the row result', async () => {
        const services = await listed(unit('mosquitto', 'active'));
        void services.actAndWatch('mosquitto', 'restart');
        fail('upgrade_in_progress', { job_id: 'j1' });
        await flush();
        expect(services.results.mosquitto).toMatchObject({ status: 'error', error: { code: 'upgrade_in_progress' } });
        expect(services.working).toBe(false);
    });

    it('waits through the calaos-server drop, then verifies after the re-login', async () => {
        const services = await listed(unit('calaos-server', 'active'));
        await accepted(services, 'calaos-server');
        expect(services.selfPhase).toBe('waiting');

        useConnectionStore().applyStatus({ status: 'reconnecting', attempt: 1, nextRetryMs: 1000 });
        useAdminStore().handleTransportLost();
        await flush();
        expect(services.selfPhase).toBe('reconnecting');

        // Nothing goes out until the household login is back.
        harness.sent = [];
        vi.advanceTimersByTime(RESTART_POLL_MS * 3);
        expect(harness.sent.filter((f) => f.data.action === 'services_list')).toHaveLength(0);

        useConnectionStore().applyStatus({ status: 'open', attempt: 0, nextRetryMs: 0 });
        useAuthStore().$patch({ state: 'pending' });
        await flush();
        useAuthStore().$patch({ state: 'authed' });
        await flush();
        vi.advanceTimersByTime(0);
        expect(last().data.action).toBe('services_list');
        ok({ services: [unit('calaos-server', 'active', AFTER)] });
        await flush();
        expect(services.results['calaos-server']).toEqual({ verb: 'restart', status: 'done' });
        expect(services.selfPhase).toBeNull();
    });

    it('a calaos-server restart whose reply never came is still followed', async () => {
        const services = await listed(unit('calaos-server', 'active'));
        void services.actAndWatch('calaos-server', 'restart');
        vi.advanceTimersByTime(5_100);
        await flush();
        expect(services.results['calaos-server']).toBeUndefined();
        expect(services.selfPhase).toBe('waiting');
    });

    it('an older daemon stays in the panel: the Admin page stays unlocked', async () => {
        await unlocked();
        const services = useAdminServicesStore();
        void services.load();
        fail('daemon_too_old');
        await flush();
        expect(useAdminStore().gate).toBe('unlocked');
        expect(services.error?.code).toBe('daemon_too_old');
        const restarted = services.restart('calaos-home');
        fail('daemon_too_old');
        expect(await restarted).toMatchObject({ outcome: 'failed', error: { code: 'daemon_too_old' } });
        expect(useAdminStore().gate).toBe('unlocked');
    });
});
