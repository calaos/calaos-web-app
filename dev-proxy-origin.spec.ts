// @vitest-environment node
import { createServer as createHttpServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';

import { isDevServerOrigin } from './dev-proxy-origin';

describe('isDevServerOrigin', () => {
    it.each([
        ['http://localhost:5173', 'localhost:5173'],
        ['http://127.0.0.1:5173', '127.0.0.1:5173'],
        ['http://[::1]:5173', '[::1]:5173'],
        ['http://192.168.1.20:5173', '192.168.1.20:5173'],
        ['https://localhost', 'localhost'],
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
        ['http://app.localhost:5173', 'app.localhost:5173'],
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

// Runs the real vite.config.ts proxy, so a Vite or http-proxy upgrade that
// drops the hooks shows up here.
describe('dev proxy wiring', () => {
    const seen: IncomingHttpHeaders[] = [];
    let backend: Server;
    let vite: ViteDevServer;
    let base: string;

    beforeAll(async () => {
        backend = createHttpServer((req, res) => {
            seen.push(req.headers);
            res.end('ok');
        });
        const wss = new WebSocketServer({ server: backend });
        wss.on('connection', (ws, req) => {
            seen.push(req.headers);
            ws.close();
        });
        await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
        process.env.CALAOS_SERVER = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;

        vite = await createViteServer({
            configFile: 'vite.config.ts',
            logLevel: 'silent',
            server: { host: '127.0.0.1', port: 0, hmr: false },
        });
        await vite.listen();
        base = `127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await vite?.close();
        await new Promise((resolve) => backend?.close(resolve));
        delete process.env.CALAOS_SERVER;
    });

    const viaHttp = async (origin: string) => {
        seen.length = 0;
        await fetch(`http://${base}/api.php`, { method: 'POST', headers: { origin }, body: '{}' });
        return seen[0];
    };

    const viaWs = (origin: string) =>
        new Promise<IncomingHttpHeaders>((resolve, reject) => {
            seen.length = 0;
            const ws = new WebSocket(`ws://${base}/api`, { origin });
            ws.on('close', () => resolve(seen[0]));
            ws.on('error', reject);
        });

    it('drops the dev page Origin on HTTP and WS', async () => {
        const origin = `http://${base}`;
        expect((await viaHttp(origin)).origin).toBeUndefined();
        expect((await viaWs(origin)).origin).toBeUndefined();
    });

    it('forwards a foreign Origin on HTTP and WS', async () => {
        expect((await viaHttp('http://evil.example')).origin).toBe('http://evil.example');
        expect((await viaWs('http://evil.example')).origin).toBe('http://evil.example');
    });
});
