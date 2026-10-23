// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { isDevServerOrigin } from './dev-proxy-origin';

describe('isDevServerOrigin', () => {
    it.each([
        ['http://localhost:5173', 'localhost:5173'],
        ['http://127.0.0.1:5173', '127.0.0.1:5173'],
        ['http://[::1]:5173', '[::1]:5173'],
        ['http://192.168.1.20:5173', '192.168.1.20:5173'],
        ['http://app.localhost:4173', 'app.localhost:4173'],
        ['https://localhost', 'localhost:443'],
        ['http://localhost:5173', 'LOCALHOST:5173'],
    ])('strips the dev page origin %s (Host %s)', (origin, host) => {
        expect(isDevServerOrigin(origin, host)).toBe(true);
    });

    it.each([
        // cross-site page driving the proxy
        ['http://evil.example', 'localhost:5173'],
        // DNS rebinding onto the dev server
        ['http://evil.example:5173', 'evil.example:5173'],
        ['http://calaos.local:5173', 'calaos.local:5173'],
        ['http://localhost:5174', 'localhost:5173'],
        ['null', 'localhost:5173'],
        ['file://', 'localhost:5173'],
        ['http://localhost:5173/', 'localhost:5173'],
        ['http://localhost:5173', undefined],
        [undefined, 'localhost:5173'],
        ['', 'localhost:5173'],
    ])('keeps %s (Host %s)', (origin, host) => {
        expect(isDevServerOrigin(origin, host)).toBe(false);
    });
});
