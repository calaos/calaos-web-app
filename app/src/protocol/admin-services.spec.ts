import { describe, expect, it } from 'vitest';
import { SERVICE_IDS, SERVICE_ID_PATTERN, servicesRestartParams, toServiceRestart, toServices } from './admin-services';

describe('services codec', () => {
    it('reads the daemon list, real types kept', () => {
        const [service, missing] = toServices({
            services: [
                {
                    id: 'mosquitto',
                    unit: 'mosquitto.service',
                    kind: 'service',
                    restartable: true,
                    active_state: 'active',
                    sub_state: 'running',
                    enabled: 'enabled',
                    since: '2026-10-25T07:41:12Z',
                },
                { id: 'olad', unit: 'olad.service', kind: 'service', restartable: true, active_state: 'not-found', sub_state: '', enabled: '', since: null },
            ],
        });
        expect(service).toEqual({
            id: 'mosquitto',
            unit: 'mosquitto.service',
            kind: 'service',
            restartable: true,
            activeState: 'active',
            subState: 'running',
            enabled: 'enabled',
            since: '2026-10-25T07:41:12Z',
        });
        expect(missing).toMatchObject({ activeState: 'not-found', since: '' });
    });

    it('never throws on a malformed list, and maps an unknown state', () => {
        expect(toServices(null)).toEqual([]);
        expect(toServices({ services: 'x' })).toEqual([]);
        expect(toServices({ services: [{ id: 'x', active_state: 'maintenance', kind: 'timer' }] })[0]).toMatchObject({
            activeState: 'unknown',
            kind: 'service',
            restartable: false,
        });
    });

    it('reads the restart answer and builds its params from an id', () => {
        expect(toServiceRestart({ id: 'mosquitto', state: 'restarting' })).toEqual({ id: 'mosquitto', state: 'restarting' });
        expect(toServiceRestart({})).toBeNull();
        expect(servicesRestartParams('calaos-ddns')).toEqual({ unit: 'calaos-ddns' });
    });

    it('has ids calaos_server accepts', () => {
        expect(SERVICE_IDS).toHaveLength(15);
        expect(SERVICE_IDS.every((id) => SERVICE_ID_PATTERN.test(id))).toBe(true);
        expect(SERVICE_ID_PATTERN.test('mosquitto.service')).toBe(false);
    });
});
