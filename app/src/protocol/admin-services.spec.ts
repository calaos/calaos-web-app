import { describe, expect, it } from 'vitest';
import { SERVICE_IDS, SERVICE_ID_PATTERN, serviceParams, toServices } from './admin-services';

describe('services codec', () => {
    it('reads the daemon list, real types kept', () => {
        const [service, missing] = toServices({
            services: [
                {
                    id: 'mosquitto',
                    unit: 'mosquitto.service',
                    boot_unit: 'mosquitto.service',
                    actions: ['restart', 'start', 'stop', 'enable', 'disable'],
                    restartable: true,
                    active_state: 'active',
                    sub_state: 'running',
                    enabled: 'enabled',
                    startup: 'enabled',
                    since: '2026-10-25T07:41:12Z',
                },
                { id: 'olad', unit: 'olad.service', actions: [], active_state: 'not-found', sub_state: '', startup: '', since: null },
            ],
        });
        expect(service).toEqual({
            id: 'mosquitto',
            unit: 'mosquitto.service',
            bootUnit: 'mosquitto.service',
            actions: ['restart', 'start', 'stop', 'enable', 'disable'],
            activeState: 'active',
            subState: 'running',
            startup: 'enabled',
            since: '2026-10-25T07:41:12Z',
        });
        expect(missing).toMatchObject({ activeState: 'not-found', since: '' });
    });

    it('never throws on a malformed list, and maps an unknown state', () => {
        expect(toServices(null)).toEqual([]);
        expect(toServices({ services: 'x' })).toEqual([]);
        expect(toServices({ services: [{ id: 'x', active_state: 'maintenance' }] })[0]).toMatchObject({
            activeState: 'unknown',
            actions: [],
            startup: '',
        });
    });

    it('keeps only the verbs it knows, and reads an older daemon by `restartable`', () => {
        const read = (row: Record<string, unknown>) => toServices({ services: [row] })[0].actions;
        expect(read({ actions: ['stop', 'mask', 'restart', 3] })).toEqual(['restart', 'stop']);
        expect(read({ restartable: true })).toEqual(['restart']);
        expect(read({ restartable: false })).toEqual([]);
    });

    it('builds the params of a verb from an id', () => {
        expect(serviceParams('mosquitto')).toEqual({ unit: 'mosquitto' });
    });

    it('has ids calaos_server accepts', () => {
        expect(SERVICE_IDS).toHaveLength(14);
        expect(SERVICE_IDS.every((id) => SERVICE_ID_PATTERN.test(id))).toBe(true);
        expect(SERVICE_ID_PATTERN.test('mosquitto.service')).toBe(false);
    });
});
