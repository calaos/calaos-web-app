import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminStore } from './admin';
import { useAdminServicesStore } from './adminServices';
import { SESSION, flush, last, ok, setUp, unlocked } from './adminTestHarness';

beforeEach(setUp);

afterEach(() => {
    vi.useRealTimers();
});

describe('services store', () => {
    it('lists, and restarts by id', async () => {
        await unlocked();
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
        await unlocked();
        const services = useAdminServicesStore();
        const pending = services.restart('calaos-server');
        useAdminStore().handleTransportLost();
        expect(await pending).toEqual({ outcome: 'self_restarting', error: null });
        expect(services.isSelfRestartDrop()).toBe(true);
        vi.advanceTimersByTime(6_000);
        expect(services.isSelfRestartDrop()).toBe(false);
    });
});
