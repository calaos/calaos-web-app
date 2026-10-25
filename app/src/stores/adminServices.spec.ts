import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminStore } from './admin';
import { useAuthStore } from './auth';
import { useConnectionStore } from './connection';
import { RESTART_DEADLINE_MS, RESTART_POLL_MS, useAdminServicesStore } from './adminServices';
import { SESSION, fail, flush, harness, last, ok, setUp, unlocked } from './adminTestHarness';

const BEFORE = '2026-10-22T08:00:00Z';
const AFTER = '2026-10-25T10:00:00Z';

function unit(id: string, active_state: string, since: string | null = BEFORE, kind = 'service') {
    return { id, unit: `${id}.service`, kind, restartable: true, active_state, sub_state: '', enabled: '', since };
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

async function accepted(services: ReturnType<typeof useAdminServicesStore>, id: string): Promise<void> {
    void services.restartAndWatch(id);
    expect(last().data.params).toEqual({ unit: id });
    ok({ id, state: 'restarting' });
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
        ok({ services: [{ id: 'mosquitto', kind: 'service', restartable: true, active_state: 'active' }] });
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
        expect(services.results.mosquitto).toEqual({ status: 'done' });
        expect(services.restarting).toBe(false);
    });

    it('reports failed, not installed, and the deadline', async () => {
        const services = await listed(unit('grafana', 'active'), unit('envoy', 'active'), unit('influxdb', 'active'));
        await accepted(services, 'grafana');
        await accepted(services, 'envoy');
        await accepted(services, 'influxdb');
        await poll(unit('grafana', 'failed'), unit('envoy', 'not-found', null), unit('influxdb', 'active'));
        expect(services.results.grafana).toEqual({ status: 'failed' });
        expect(services.results.envoy).toEqual({ status: 'not_found' });
        expect(services.results.influxdb).toBeUndefined();

        for (let waited = RESTART_POLL_MS; waited < RESTART_DEADLINE_MS; waited += RESTART_POLL_MS) {
            await poll(unit('influxdb', 'active'));
        }
        expect(services.results.influxdb).toEqual({ status: 'timeout' });
    });

    it('a oneshot is done once seen running and back, without a new `since`', async () => {
        const services = await listed(unit('calaos-ddns', 'inactive', BEFORE, 'oneshot'));
        await accepted(services, 'calaos-ddns');
        await poll(unit('calaos-ddns', 'activating', BEFORE, 'oneshot'));
        await poll(unit('calaos-ddns', 'inactive', BEFORE, 'oneshot'));
        expect(services.results['calaos-ddns']).toEqual({ status: 'done' });
    });

    it('shows the 409 of a running upgrade as the row result', async () => {
        const services = await listed(unit('mosquitto', 'active'));
        void services.restartAndWatch('mosquitto');
        fail('upgrade_in_progress', { job_id: 'j1' });
        await flush();
        expect(services.results.mosquitto).toMatchObject({ status: 'error', error: { code: 'upgrade_in_progress' } });
        expect(services.restarting).toBe(false);
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
        expect(services.results['calaos-server']).toEqual({ status: 'done' });
        expect(services.selfPhase).toBeNull();
    });

    it('a calaos-server restart whose reply never came is still followed', async () => {
        const services = await listed(unit('calaos-server', 'active'));
        void services.restartAndWatch('calaos-server');
        vi.advanceTimersByTime(5_100);
        await flush();
        expect(services.results['calaos-server']).toBeUndefined();
        expect(services.selfPhase).toBe('waiting');
    });
});
