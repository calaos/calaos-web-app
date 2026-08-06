// `/control` — the mock server's out-of-band test API.
//
// Not part of the calaos protocol: it exists so vitest and Playwright can drive
// the mock (push events, kill sockets, inspect received frames, force login
// failures) without touching the WebSocket the app under test is using.
//
//   GET  /control            → status snapshot (also the readiness probe)
//   POST /control  {op:...}  → one of the ops below
//
//   {op:'push_io', id, state}   force an IO state + broadcast io_changed
//   {op:'push_audio', id, status?, volume?, track?}
//                               force audio player state + broadcast the
//                               matching audio_* events (status uses the event
//                               vocabulary 'play'|'pause'|'stop'; track is a
//                               current_track object)
//   {op:'drop'}                 destroy every open WebSocket (no close frame)
//   {op:'scenario', name}       'login_fail_once' | 'silent_login'
//                               | 'reject_all_logins' | 'reset'
//   {op:'latency', ms}          delay every outgoing WS frame by ms
//   {op:'log'}                  every WS frame received, in order
//   {op:'reset'}                reload fixtures, clear log, scenario, latency

export const SCENARIOS = ['login_fail_once', 'silent_login', 'reject_all_logins', 'reset'];

/** Read a request body and JSON.parse it; `{}` for an empty body. */
export async function readJsonBody(req, limitBytes = 1_000_000) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > limitBytes) throw new Error('body too large');
        chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (raw === '') return {};
    return JSON.parse(raw);
}

/**
 * Apply one control op against the running server hub.
 * @returns {{status: number, body: object}}
 */
export function applyControlOp(hub, body) {
    const op = body?.op;

    switch (op) {
        case 'push_io': {
            const { id, state } = body;
            if (typeof id !== 'string' || id === '') {
                return { status: 400, body: { ok: false, error: 'push_io requires a string id' } };
            }
            const known = hub.state.pushIo(id, state ?? '');
            return { status: 200, body: { ok: true, op, id, state: String(state ?? ''), known } };
        }

        case 'push_audio': {
            const { id, status, volume, track } = body;
            if (typeof id !== 'string' || id === '') {
                return { status: 400, body: { ok: false, error: 'push_audio requires a string id' } };
            }
            if (status === undefined && volume === undefined && track === undefined) {
                return {
                    status: 400,
                    body: { ok: false, error: 'push_audio requires status, volume and/or track' },
                };
            }
            const known = hub.state.pushAudio(id, { status, volume, track });
            return { status: 200, body: { ok: true, op, id, known } };
        }

        case 'drop': {
            const dropped = hub.dropClients();
            return { status: 200, body: { ok: true, op, dropped } };
        }

        case 'scenario': {
            const { name } = body;
            if (!SCENARIOS.includes(name)) {
                return {
                    status: 400,
                    body: { ok: false, error: `unknown scenario '${name}'`, known: SCENARIOS },
                };
            }
            // 'reset' is the off switch, not a scenario the server can be in.
            hub.scenario = name === 'reset' ? { name: null, consumed: false } : { name, consumed: false };
            return { status: 200, body: { ok: true, op, scenario: hub.scenario.name } };
        }

        case 'latency': {
            const ms = Number(body.ms);
            if (!Number.isFinite(ms) || ms < 0) {
                return { status: 400, body: { ok: false, error: 'latency requires ms >= 0' } };
            }
            hub.latencyMs = ms;
            return { status: 200, body: { ok: true, op, latencyMs: ms } };
        }

        case 'log':
            return { status: 200, body: { ok: true, op, log: hub.log } };

        case 'reset': {
            hub.state.reset();
            hub.log.length = 0;
            hub.scenario = { name: null, consumed: false };
            hub.latencyMs = 0;
            return { status: 200, body: { ok: true, op } };
        }

        default:
            return {
                status: 400,
                body: {
                    ok: false,
                    error: `unknown op '${op}'`,
                    known: ['push_io', 'push_audio', 'drop', 'scenario', 'latency', 'log', 'reset'],
                },
            };
    }
}

/** Status snapshot; doubles as the Playwright `webServer.url` readiness probe. */
export function controlStatus(hub) {
    return {
        ok: true,
        service: 'calaos-mock-server',
        port: hub.port,
        user: hub.user,
        clients: hub.clients.size,
        scenario: hub.scenario.name,
        latencyMs: hub.latencyMs,
        logSize: hub.log.length,
        ops: ['push_io', 'push_audio', 'drop', 'scenario', 'latency', 'log', 'reset'],
    };
}

/** HTTP glue for GET/POST/OPTIONS on /control. */
export async function handleControlRequest(hub, req, res) {
    // The mock is only ever reached from tests and the dev proxy, but
    // permissive CORS keeps a browser-side control call from failing.
    const cors = {
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
    };
    const json = (status, payload) => {
        res.writeHead(status, { ...cors, 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
    };

    if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        res.end();
        return;
    }

    if (req.method === 'GET') {
        json(200, controlStatus(hub));
        return;
    }

    if (req.method !== 'POST') {
        json(405, { ok: false, error: 'use GET for status or POST for ops' });
        return;
    }

    let body;
    try {
        body = await readJsonBody(req);
    } catch {
        json(400, { ok: false, error: 'invalid JSON body' });
        return;
    }

    const { status, body: payload } = applyControlOp(hub, body);
    json(status, payload);
}
