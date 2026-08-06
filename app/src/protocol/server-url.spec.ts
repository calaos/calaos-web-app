import { describe, expect, it } from 'vitest';
import { wsUrl } from './server-url';

describe('wsUrl', () => {
    it('uses ws:// for http pages and wss:// for https pages', () => {
        expect(wsUrl({ protocol: 'http:', host: 'calaos.local:5454' })).toBe(
            'ws://calaos.local:5454/api',
        );
        expect(wsUrl({ protocol: 'https:', host: 'x:5454' })).toBe('wss://x:5454/api');
    });

    // Regression: the old getHost() concatenated hostname + ':' + port, and
    // location.port is '' on the default port → 'ws://calaos.local:/api'.
    it('omits the port when the page is served on the default port', () => {
        expect(wsUrl({ protocol: 'http:', host: 'calaos.local' })).toBe('ws://calaos.local/api');
        expect(wsUrl({ protocol: 'https:', host: 'calaos.local' })).toBe('wss://calaos.local/api');
    });

    it.each([
        [{ protocol: 'http:', host: 'calaos.local' }],
        [{ protocol: 'https:', host: 'calaos.local' }],
        [{ protocol: 'http:', host: '192.168.30.17:5454' }],
    ])('never emits a dangling colon for %o', (loc) => {
        expect(wsUrl(loc)).not.toContain(':/api');
    });

    it.each([
        ['http:', 'ws://'],
        ['https:', 'wss://'],
        // Only https: upgrades; anything else falls back to the plain scheme.
        ['file:', 'ws://'],
        ['HTTPS:', 'ws://'],
        ['', 'ws://'],
    ])('protocol %o → %o', (protocol, scheme) => {
        expect(wsUrl({ protocol, host: 'h' })).toBe(`${scheme}h/api`);
    });

    it('handles IPv6 and userless hosts verbatim', () => {
        expect(wsUrl({ protocol: 'http:', host: '[::1]:5454' })).toBe('ws://[::1]:5454/api');
    });

    it('defaults to the page location (same-origin deployment)', () => {
        expect(wsUrl()).toBe(`ws://${window.location.host}/api`);
    });
});
