#!/usr/bin/env node
// Mock calaos_server — offline dev backend for `npm run dev:next`, the
// Playwright `webServer`, and its own vitest regression suite.
//
// One HTTP server on PORT (default 5454) serving three things:
//   1. WebSocket upgrade on /api    — login / get_home / set_state
//   2. GET /api?action=camera&...   — a PNG snapshot, 403 on bad credentials
//   3. GET|POST /control            — the test API (see control.mjs)
//
// Every value on the calaos wire is a STRING; see docs/ARCHITECTURE.md
// "Protocol layer" and "Mock calaos_server".

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';

import { createState } from './state.mjs';
import { handleControlRequest } from './control.mjs';

const DEFAULT_PORT = 5454;
const CAMERA_PNG = readFileSync(new URL('./fixtures/camera.png', import.meta.url));

/**
 * @param {object} [options]
 * @param {number} [options.port]  0 picks a free port (used by the tests)
 * @param {string} [options.host]  default: every interface, so both
 *   `127.0.0.1` and `::1` resolutions of `localhost` reach it (Vite's proxy
 *   target is `http://localhost:5454`)
 * @param {string} [options.user]
 * @param {string} [options.pass]
 * @param {boolean} [options.quiet] silence per-connection logging
 * @returns {Promise<object>} handle with `{port, url, wsUrl, hub, close}`
 */
export function startServer(options = {}) {
    const {
        port = Number(process.env.PORT) || DEFAULT_PORT,
        host = process.env.HOST || undefined,
        user = process.env.MOCK_USER || 'demo',
        pass = process.env.MOCK_PASS || 'demo',
        quiet = false,
    } = options;

    const log = (...args) => {
        if (!quiet) console.log('[mock]', ...args);
    };

    /**
     * Shared runtime context. `control.mjs` mutates `scenario`/`latencyMs` and
     * reads `frames`, so it must stay a single mutable object.
     */
    const hub = {
        port,
        user,
        pass,
        /** @type {Set<import('ws').WebSocket>} */
        clients: new Set(),
        /** Every WS frame received, in arrival order (`/control {op:'log'}`). */
        log: [],
        /** @type {{name: string|null, consumed: boolean}} */
        scenario: { name: null, consumed: false },
        latencyMs: 0,
        state: null,
        dropClients: null,
    };

    /** Send one frame, honouring the configured latency. Order is preserved. */
    function send(ws, frame) {
        const raw = JSON.stringify(frame);
        const write = () => {
            if (ws.readyState === ws.OPEN) ws.send(raw);
        };
        if (hub.latencyMs > 0) setTimeout(write, hub.latencyMs);
        else write();
    }

    /** io_changed and friends go to every open client, authenticated or not. */
    function broadcast(frame) {
        for (const ws of hub.clients) send(ws, frame);
    }

    hub.state = createState({ broadcast });

    hub.dropClients = () => {
        const n = hub.clients.size;
        for (const ws of hub.clients) ws.terminate(); // destroy, no close frame
        hub.clients.clear();
        return n;
    };

    // ---------------------------------------------------------------- WS ---

    const wss = new WebSocketServer({ noServer: true });
    let clientSeq = 0;

    wss.on('connection', (ws) => {
        const clientId = ++clientSeq;
        ws.authed = false;
        hub.clients.add(ws);
        log(`ws client #${clientId} connected (${hub.clients.size} open)`);

        ws.on('message', (data) => {
            const raw = data.toString();
            let frame;
            try {
                frame = JSON.parse(raw);
            } catch {
                frame = null;
            }
            // Recorded before any handling so /control {op:'log'} sees every
            // frame in arrival order, parseable or not.
            hub.log.push({ seq: hub.log.length, at: Date.now(), clientId, raw, frame });
            handleFrame(ws, clientId, frame);
        });

        ws.on('close', () => {
            hub.clients.delete(ws);
            log(`ws client #${clientId} disconnected (${hub.clients.size} open)`);
        });

        // A terminated socket emits 'error' on some paths; never crash on it.
        ws.on('error', () => hub.clients.delete(ws));
    });

    function handleFrame(ws, clientId, frame) {
        if (!frame || typeof frame !== 'object' || typeof frame.msg !== 'string') {
            log(`client #${clientId}: ignoring malformed frame`);
            return;
        }

        switch (frame.msg) {
            case 'login':
                handleLogin(ws, clientId, frame);
                return;

            case 'get_home':
                if (!requireAuth(ws, clientId, 'get_home')) return;
                send(ws, { msg: 'get_home', data: hub.state.getHome() });
                return;

            case 'set_state': {
                if (!requireAuth(ws, clientId, 'set_state')) return;
                const { id, value } = frame.data ?? {};
                if (typeof id !== 'string') return;
                // Broadcast (or the deliberate absence of one for read-only and
                // scenario IOs) happens inside applySetState.
                hub.state.applySetState(id, value ?? '');
                return;
            }

            default:
                log(`client #${clientId}: unhandled msg '${frame.msg}'`);
        }
    }

    function requireAuth(ws, clientId, what) {
        if (ws.authed) return true;
        log(`client #${clientId}: ignoring '${what}' before login`);
        return false;
    }

    function handleLogin(ws, clientId, frame) {
        const { cn_user: cnUser, cn_pass: cnPass } = frame.data ?? {};
        const scenario = hub.scenario;

        if (scenario.name === 'silent_login') {
            log(`client #${clientId}: swallowing login (scenario silent_login)`);
            return;
        }

        let success = cnUser === hub.user && cnPass === hub.pass;
        if (scenario.name === 'reject_all_logins') {
            success = false;
        } else if (scenario.name === 'login_fail_once' && !scenario.consumed) {
            scenario.consumed = true;
            success = false;
        }

        ws.authed = success;
        send(ws, { msg: 'login', data: { success: success ? 'true' : 'false' } });
        log(`client #${clientId}: login '${cnUser ?? ''}' → ${success ? 'ok' : 'refused'}`);
    }

    // -------------------------------------------------------------- HTTP ---

    /** GET /api?action=camera&type=get_picture&id=..&cn_user=..&cn_pass=.. */
    function handleCamera(url, res) {
        const params = url.searchParams;
        const ok = params.get('cn_user') === hub.user && params.get('cn_pass') === hub.pass;
        if (!ok) {
            res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('Forbidden');
            return;
        }
        if (params.get('type') !== 'get_picture') {
            res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('Unsupported camera action');
            return;
        }
        const id = params.get('id') ?? '';
        if (!hub.state.getCamera(id)) {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('Unknown camera');
            return;
        }

        const respond = () => {
            res.writeHead(200, {
                'content-type': 'image/png',
                'content-length': String(CAMERA_PNG.length),
                // Snapshot polling appends &t=<now>; be explicit anyway.
                'cache-control': 'no-store',
            });
            res.end(CAMERA_PNG);
        };
        if (hub.latencyMs > 0) setTimeout(respond, hub.latencyMs);
        else respond();
    }

    const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

        if (url.pathname === '/control') {
            handleControlRequest(hub, req, res).catch((err) => {
                res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ ok: false, error: String(err) }));
            });
            return;
        }

        if (url.pathname === '/api') {
            if (url.searchParams.get('action') === 'camera') {
                handleCamera(url, res);
                return;
            }
            res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('/api expects a WebSocket upgrade or ?action=camera');
            return;
        }

        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Not found');
    });

    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        if (url.pathname !== '/api') {
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
            const actualPort = server.address().port;
            hub.port = actualPort;
            const url = `http://localhost:${actualPort}`;
            log(
                `calaos mock server listening on ${url} — ws ${url.replace('http', 'ws')}/api, ` +
                    `control ${url}/control, credentials ${user}/${pass}`,
            );

            resolve({
                port: actualPort,
                url,
                wsUrl: `ws://127.0.0.1:${actualPort}/api`,
                controlUrl: `${url}/control`,
                hub,
                server,
                close() {
                    return new Promise((done) => {
                        hub.dropClients();
                        wss.close();
                        server.close(() => done());
                        server.closeAllConnections?.();
                    });
                },
            });
        });
    });
}

// Started directly (`npm run mock`) rather than imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const handle = await startServer();

    const shutdown = (signal) => {
        console.log(`[mock] ${signal} received, shutting down`);
        handle.close().then(() => process.exit(0));
        // Don't hang forever if a socket refuses to die.
        setTimeout(() => process.exit(0), 2000).unref();
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}
