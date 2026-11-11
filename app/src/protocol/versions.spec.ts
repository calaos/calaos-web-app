import { describe, expect, it } from 'vitest';
import { formatVersionsText, toVersions } from './versions';

const client = { name: 'calaos-web-app', version: '4.2.0' };
const now = new Date('2026-11-11T10:00:00Z');

const full = toVersions({
    server: '4.8.0',
    system: {
        calaos_os: '4.8.0',
        debian: '13.1',
        kernel: '6.12.48',
        container: '1.9.1',
        packages: [
            { name: 'calaos-server', version: '4.8.0' },
            { name: 'calaos-home', version: '4.5.0' },
        ],
    },
});

describe('formatVersionsText', () => {
    it('writes the contract text, one package per line', () => {
        expect(formatVersionsText(client, full, now)).toBe(
            [
                'Calaos versions (2026-11-11)',
                'client: calaos-web-app 4.2.0',
                'calaos-server 4.8.0',
                'calaos-container 1.9.1',
                'calaos-os 4.8.0 · debian 13.1 · kernel 6.12.48',
                'calaos-server 4.8.0',
                'calaos-home 4.5.0',
            ].join('\n'),
        );
    });

    it('keeps the server and the client, then says the container is unreachable', () => {
        const down = toVersions({ server: '4.8.0', system: null, error: 'daemon_unreachable' });
        expect(formatVersionsText(client, down, now)).toBe(
            [
                'Calaos versions (2026-11-11)',
                'client: calaos-web-app 4.2.0',
                'calaos-server 4.8.0',
                'calaos-container unreachable (daemon_unreachable)',
            ].join('\n'),
        );
    });

    it('omits the reason when there is none, and skips empty OS fields', () => {
        const down = toVersions({ server: '4.8.0', system: null });
        expect(formatVersionsText(client, down, now)).toMatch(/calaos-container unreachable$/);
        const partial = toVersions({ server: 's', system: { debian: '13' } });
        expect(formatVersionsText(client, partial, now).split('\n').slice(3)).toEqual(['debian 13']);
    });

    it('writes calaos-server unavailable when the server version is empty', () => {
        const old = { server: '', system: null, error: 'old_server' };
        expect(formatVersionsText(client, old, now)).toBe(
            [
                'Calaos versions (2026-11-11)',
                'client: calaos-web-app 4.2.0',
                'calaos-server unavailable',
                'calaos-container unreachable (old_server)',
            ].join('\n'),
        );
    });

    it('still gives the client when the server could not be asked', () => {
        expect(formatVersionsText(client, null, now)).toBe(
            'Calaos versions (2026-11-11)\nclient: calaos-web-app 4.2.0\ncalaos-server unavailable',
        );
    });
});

describe('toVersions', () => {
    it('is tolerant of junk', () => {
        expect(toVersions(null)).toEqual({ server: '', system: null, error: '' });
        const v = toVersions({ server: 1, system: { packages: [{ name: '' }, 'x', { name: 'a', version: '1' }] } });
        expect(v.system?.packages).toEqual([{ name: 'a', version: '1' }]);
    });
});
