// `/api/console` of the mock calaos_server: calaos_base docs/08_http_api.md,
// "Console web". Instead of a pty behind calaos-container, an echo: what the
// browser types comes back as output, Enter starts a new prompt line.
//
// Driven from `/control {op:'console', ...}`: `close` ends every open console
// with that close code, `expiresIn` / `idleTimeout` change what `ready`
// announces, `maxConsoles` the limit, `refuseUpgrade` answers 403 to the upgrade,
// `refuseWith` refuses the next open message with that error.

import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';

export const CONSOLE_PROTOCOL = 'calaos-console.v1';
const MESSAGE_MAX = 64 * 1024;
const OPEN_TIMEOUT_MS = 30_000;
const TERMS = ['xterm-256color', 'xterm', 'vt100'];
const PROMPT = 'root@calaos:~# ';

function parseJson(data) {
    try {
        return JSON.parse(data.toString());
    } catch {
        return null;
    }
}

function sizeOk(value) {
    return Number.isInteger(value) && value >= 1 && value <= 1000;
}

export function createConsole({ hub, log }) {
    const wss = new WebSocketServer({
        noServer: true,
        maxPayload: MESSAGE_MAX,
        handleProtocols: (protocols) => (protocols.has(CONSOLE_PROTOCOL) ? CONSOLE_PROTOCOL : false),
    });
    /** @type {Set<import('ws').WebSocket>} */
    const open = new Set();
    let state;

    function reset() {
        for (const ws of open) ws.terminate();
        open.clear();
        state = {
            expiresIn: 3600,
            idleTimeout: 900,
            maxConsoles: 2,
            /** Refuse the upgrade itself, as calaos_server does over plain http (403). */
            refuseUpgrade: false,
            /** One-shot: the next open message is refused with this payload ({error, ...extra}). */
            refuseWith: null,
            /** Every connection: its URL, and the keys of its open message (values never kept). */
            connections: [],
            /** Every input / resize / binary message after `ready`, in order. */
            received: [],
        };
    }
    reset();

    function refuse(ws, error, msg, extra = {}) {
        ws.send(JSON.stringify({ type: 'error', success: 'false', error, msg, ...extra }));
        ws.close(1008, 'console refused');
    }

    function checkOpen(frame) {
        if (state.refuseWith !== null) {
            const { error, ...extra } = state.refuseWith;
            state.refuseWith = null;
            return [error, `Refused (${error})`, extra];
        }
        if (frame === null || typeof frame !== 'object' || frame.type !== 'open') {
            return ['invalid_request', 'Expected an open message'];
        }
        if (frame.cn_user !== hub.user || frame.cn_pass !== hub.pass) return ['login_failed', 'Login failed'];
        if (!sizeOk(frame.columns) || !sizeOk(frame.rows)) return ['invalid_request', 'Invalid terminal size'];
        if (frame.term !== undefined && !TERMS.includes(frame.term)) return ['invalid_request', 'Invalid term'];
        if (typeof frame.code_id !== 'string' || !/^[0-9a-f]{16}$/.test(frame.code_id)) {
            return ['invalid_request', 'Invalid code_id'];
        }
        const refusal = hub.admin.takeConsoleGrant(frame.admin_session, frame.code_id);
        if (refusal !== null) {
            const { error, msg, ...extra } = refusal;
            delete extra.success;
            return [error, msg, extra];
        }
        if (open.size >= state.maxConsoles) {
            return ['console_limit', 'Two consoles at most', { max: String(state.maxConsoles) }];
        }
        return null;
    }

    function start(ws, entry) {
        open.add(ws);
        entry.ready = true;
        ws.send(JSON.stringify({
            type: 'ready',
            console_id: randomBytes(8).toString('hex'),
            expires_in: state.expiresIn,
            idle_timeout: state.idleTimeout,
        }));
        ws.send(Buffer.from(`Calaos mock console\r\n${PROMPT}`));
    }

    function echo(ws, text) {
        ws.send(Buffer.from(text.replace(/\r/g, `\r\n${PROMPT}`)));
    }

    wss.on('connection', (ws, req) => {
        const entry = { url: req.url, protocol: ws.protocol, openKeys: null, ready: false };
        state.connections.push(entry);
        let opened = false;
        const timer = setTimeout(() => refuse(ws, 'invalid_request', 'No open message'), OPEN_TIMEOUT_MS);

        ws.on('message', (data, isBinary) => {
            if (!opened) {
                if (isBinary) return;
                opened = true;
                clearTimeout(timer);
                const frame = parseJson(data);
                if (frame !== null && typeof frame === 'object') entry.openKeys = Object.keys(frame).sort();
                const refusal = checkOpen(frame);
                if (refusal !== null) {
                    log(`console refused: ${refusal[0]}`);
                    refuse(ws, refusal[0], refusal[1], refusal[2]);
                    return;
                }
                start(ws, entry);
                return;
            }
            if (isBinary) {
                state.received.push({ type: 'binary', data: data.toString('latin1') });
                echo(ws, data.toString('latin1'));
                return;
            }
            const frame = parseJson(data);
            if (frame?.type === 'input' && typeof frame.data === 'string') {
                state.received.push({ type: 'input', data: frame.data });
                echo(ws, frame.data);
            } else if (frame?.type === 'resize' && sizeOk(frame.columns) && sizeOk(frame.rows)) {
                state.received.push({ type: 'resize', columns: frame.columns, rows: frame.rows });
            }
        });

        ws.on('close', () => {
            clearTimeout(timer);
            open.delete(ws);
        });
        ws.on('error', () => open.delete(ws));
    });

    function handleUpgrade(req, socket, head) {
        if (state.refuseUpgrade) {
            socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
            return;
        }
        const protocols = String(req.headers['sec-websocket-protocol'] ?? '')
            .split(',')
            .map((p) => p.trim());
        if (!protocols.includes(CONSOLE_PROTOCOL)) {
            socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    }

    function configure(patch) {
        if (patch.expiresIn !== undefined) state.expiresIn = Number(patch.expiresIn);
        if (patch.idleTimeout !== undefined) state.idleTimeout = Number(patch.idleTimeout);
        if (patch.maxConsoles !== undefined) state.maxConsoles = Number(patch.maxConsoles);
        if (patch.refuseUpgrade !== undefined) state.refuseUpgrade = Boolean(patch.refuseUpgrade);
        if (patch.refuseWith !== undefined) state.refuseWith = patch.refuseWith;
        if (patch.close !== undefined) {
            const code = Number(patch.close);
            for (const ws of open) ws.close(code, 'console closed');
        }
        return { ok: true, ...status() };
    }

    function status() {
        return { open: open.size, connections: state.connections, received: state.received };
    }

    function close() {
        for (const ws of open) ws.terminate();
        wss.close();
    }

    return { reset, handleUpgrade, configure, status, close };
}
