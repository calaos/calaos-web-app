// @vitest-environment node
//
// Regression suite for the mock calaos_server. Drives a real server instance
// on an ephemeral port through a raw `ws` client and `fetch`, so what is
// asserted here is exactly what the app (T05+) and Playwright (T08+) see.

import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { startServer } from './index.mjs';
import { nextState } from './state.mjs';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/home.json', import.meta.url), 'utf8'));
const CAMERA_PNG = readFileSync(new URL('./fixtures/camera.png', import.meta.url));

const GUI_TYPES = [
    'temp',
    'analog_in',
    'analog_out',
    'light',
    'light_dimmer',
    'light_rgb',
    'shutter',
    'shutter_smart',
    'var_bool',
    'var_int',
    'var_string',
    'string_out',
    'string_in',
    'scenario',
];

/** @type {Awaited<ReturnType<typeof startServer>>} */
let server;
/** Clients opened by the current test, torn down in afterEach. */
let openClients = [];

beforeAll(async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
});

afterAll(async () => {
    await server.close();
});

afterEach(async () => {
    for (const c of openClients) c.terminate();
    openClients = [];
    await control({ op: 'reset' });
});

// ------------------------------------------------------------- helpers ---

async function control(body) {
    const res = await fetch(server.controlUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Raw `ws` client with a frame log and a consuming `waitFor`. */
function createClient(url = server.wsUrl) {
    const ws = new WebSocket(url);
    /** Every frame received, never consumed — for "nothing arrived" assertions. */
    const frames = [];
    const waiters = [];
    let cursor = 0;

    ws.on('message', (data) => {
        const frame = JSON.parse(data.toString());
        frames.push(frame);
        const hit = waiters.findIndex((w) => w.pred(frame));
        if (hit !== -1) {
            const [w] = waiters.splice(hit, 1);
            cursor = frames.length;
            clearTimeout(w.timer);
            w.resolve(frame);
        }
    });

    const client = {
        ws,
        frames,
        opened: new Promise((resolve, reject) => {
            ws.once('open', resolve);
            ws.once('error', reject);
        }),
        closed: new Promise((resolve) => ws.once('close', (code) => resolve(code))),
        send(frame) {
            ws.send(JSON.stringify(frame));
            return client;
        },
        /** Resolve with the first unconsumed frame matching `pred`. */
        waitFor(pred, timeout = 2000) {
            for (let i = cursor; i < frames.length; i++) {
                if (pred(frames[i])) {
                    cursor = i + 1;
                    return Promise.resolve(frames[i]);
                }
            }
            return new Promise((resolve, reject) => {
                const w = { pred, resolve };
                w.timer = setTimeout(() => {
                    waiters.splice(waiters.indexOf(w), 1);
                    reject(new Error(`timed out; received ${JSON.stringify(frames)}`));
                }, timeout);
                waiters.push(w);
            });
        },
        terminate() {
            ws.terminate();
        },
    };

    openClients.push(client);
    return client;
}

const isLogin = (f) => f.msg === 'login';
const isGetHome = (f) => f.msg === 'get_home';
const ioChangedFor = (id) => (f) =>
    f.msg === 'event' && f.data?.type_str === 'io_changed' && f.data?.data?.id === id;

/** Connected + authenticated client. */
async function login(user = 'demo', pass = 'demo') {
    const c = createClient();
    await c.opened;
    c.send({ msg: 'login', data: { cn_user: user, cn_pass: pass } });
    const reply = await c.waitFor(isLogin);
    return { client: c, reply };
}

function cameraUrl(id, user = 'demo', pass = 'demo') {
    const q = new URLSearchParams({
        cn_user: user,
        cn_pass: pass,
        action: 'camera',
        type: 'get_picture',
        id,
    });
    return `${server.url}/api?${q}`;
}

// --------------------------------------------------------------- tests ---

describe('fixtures/home.json', () => {
    it('covers all 14 gui_types', () => {
        const seen = new Set(FIXTURE.home.flatMap((room) => room.items.map((io) => io.gui_type)));
        expect([...seen].sort()).toEqual([...GUI_TYPES].sort());
    });

    it('is strings all the way down (the calaos wire has no other type)', () => {
        const walk = (value, path) => {
            if (Array.isArray(value)) {
                value.forEach((v, i) => walk(v, `${path}[${i}]`));
            } else if (value && typeof value === 'object') {
                for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
            } else {
                expect(typeof value, `${path} = ${JSON.stringify(value)}`).toBe('string');
            }
        };
        walk(FIXTURE, '$');
    });

    it('has exactly one hidden IO and exactly one read-only IO', () => {
        const ios = FIXTURE.home.flatMap((room) => room.items);
        expect(ios.filter((io) => io.visible === 'false')).toHaveLength(1);
        expect(ios.filter((io) => io.rw === 'false')).toHaveLength(1);
        // Everything else must be explicitly the other way round, not absent.
        for (const io of ios) {
            expect(['true', 'false']).toContain(io.visible);
            expect(['true', 'false']).toContain(io.rw);
        }
    });

    it('ships rooms with unsorted hits, so the client sort is exercised', () => {
        const hits = FIXTURE.home.map((room) => Number(room.hits));
        const sortedDesc = [...hits].sort((a, b) => b - a);
        expect(hits).not.toEqual(sortedDesc);
        expect(FIXTURE.home.length).toBeGreaterThanOrEqual(3);
    });

    it('carries the documented realistic states and units', () => {
        const byId = new Map(FIXTURE.home.flatMap((r) => r.items).map((io) => [io.id, io]));
        expect(byId.get('output_2').state).toBe('set 50'); // dimmer
        expect(byId.get('output_3').state).toBe('#ff2200'); // rgb
        expect(byId.get('output_4').state).toBe('up 100'); // shutter_smart
        expect(byId.get('output_11').state).toBe(''); // empty var_string
        expect(byId.get('input_1').unit).toBe('°C'); // temp
        expect(byId.get('input_2').unit).toBe('lux'); // analog_in
        expect(byId.get('output_8').unit).toBe('tasses'); // var_int
    });

    it('has 2 cameras and 1 audio player in the documented shape', () => {
        expect(FIXTURE.cameras).toHaveLength(2);
        for (const cam of FIXTURE.cameras) expect(Object.keys(cam).sort()).toEqual(['id', 'name']);

        expect(FIXTURE.audio).toHaveLength(1);
        const player = FIXTURE.audio[0];
        expect(Object.keys(player).sort()).toEqual(['current_track', 'id', 'name', 'status']);
        expect(Object.keys(player.current_track).sort()).toEqual([
            'album',
            'artist',
            'duration',
            'title',
        ]);
    });

    it('ships a valid PNG snapshot', () => {
        expect(CAMERA_PNG.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
        expect(CAMERA_PNG.subarray(12, 16).toString('latin1')).toBe('IHDR');
        expect(CAMERA_PNG.subarray(-8, -4).toString('latin1')).toBe('IEND');
    });
});

describe('login', () => {
    it('accepts demo/demo', async () => {
        const { reply } = await login();
        expect(reply).toEqual({ msg: 'login', data: { success: 'true' } });
    });

    it('refuses a wrong password', async () => {
        const { reply } = await login('demo', 'wrong');
        expect(reply).toEqual({ msg: 'login', data: { success: 'false' } });
    });

    it('refuses an unknown user', async () => {
        const { reply } = await login('nobody', 'demo');
        expect(reply.data.success).toBe('false');
    });

    it('honours MOCK_USER / MOCK_PASS', async () => {
        process.env.MOCK_USER = 'alice';
        process.env.MOCK_PASS = 's3cret';
        let alt;
        try {
            alt = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
            const c = createClient(alt.wsUrl);
            await c.opened;
            c.send({ msg: 'login', data: { cn_user: 'alice', cn_pass: 's3cret' } });
            expect((await c.waitFor(isLogin)).data.success).toBe('true');

            const d = createClient(alt.wsUrl);
            await d.opened;
            d.send({ msg: 'login', data: { cn_user: 'demo', cn_pass: 'demo' } });
            expect((await d.waitFor(isLogin)).data.success).toBe('false');
        } finally {
            delete process.env.MOCK_USER;
            delete process.env.MOCK_PASS;
            await alt?.close();
        }
    });
});

describe('get_home', () => {
    it('matches the wire spec', async () => {
        const { client } = await login();
        client.send({ msg: 'get_home' });
        const frame = await client.waitFor(isGetHome);

        expect(Object.keys(frame.data).sort()).toEqual(['audio', 'cameras', 'home']);

        for (const room of frame.data.home) {
            expect(Object.keys(room).sort()).toEqual(['hits', 'items', 'name', 'type']);
            for (const io of room.items) {
                expect(io).toMatchObject({
                    id: expect.any(String),
                    name: expect.any(String),
                    gui_type: expect.any(String),
                    state: expect.any(String),
                    visible: expect.any(String),
                    rw: expect.any(String),
                    unit: expect.any(String),
                });
                // gui_style is the only optional field; nothing else may leak.
                const allowed = ['id', 'name', 'gui_type', 'gui_style', 'state', 'visible', 'rw', 'unit'];
                expect(Object.keys(io).filter((k) => !allowed.includes(k))).toEqual([]);
            }
        }

        expect(frame.data).toEqual(FIXTURE);
    });

    it('is ignored before login', async () => {
        const c = createClient();
        await c.opened;
        c.send({ msg: 'get_home' });
        await sleep(150);
        expect(c.frames).toEqual([]);
    });

    it('ignores malformed and unknown frames without dying', async () => {
        const { client } = await login();
        client.ws.send('not json at all');
        client.send({ msg: 'no_such_command' });
        client.send({ msg: 'get_home' });
        await expect(client.waitFor(isGetHome)).resolves.toBeTruthy();
    });
});

describe('set_state', () => {
    it('broadcasts io_changed to a second client', async () => {
        const { client: a } = await login();
        const { client: b } = await login();

        a.send({ msg: 'set_state', data: { id: 'output_1', value: 'false' } });

        const onA = await a.waitFor(ioChangedFor('output_1'));
        const onB = await b.waitFor(ioChangedFor('output_1'));
        const expected = {
            msg: 'event',
            data: { type_str: 'io_changed', data: { id: 'output_1', state: 'false' } },
        };
        expect(onA).toEqual(expected);
        expect(onB).toEqual(expected);
    });

    it('persists the new state into the next get_home', async () => {
        const { client } = await login();
        client.send({ msg: 'set_state', data: { id: 'output_2', value: 'set 80' } });
        await client.waitFor(ioChangedFor('output_2'));

        client.send({ msg: 'get_home' });
        const home = await client.waitFor(isGetHome);
        const io = home.data.home.flatMap((r) => r.items).find((i) => i.id === 'output_2');
        expect(io.state).toBe('80');
    });

    it('does not broadcast for a scenario, but still logs the frame', async () => {
        const { client } = await login();
        const frame = { msg: 'set_state', data: { id: 'output_5', value: 'true' } };
        client.send(frame);
        await sleep(150);

        expect(client.frames.filter((f) => f.msg === 'event')).toEqual([]);
        const { body } = await control({ op: 'log' });
        expect(body.log.map((e) => e.frame)).toContainEqual(frame);
    });

    it('does not broadcast for read-only IOs or unknown ids', async () => {
        const { client } = await login();
        client.send({ msg: 'set_state', data: { id: 'input_1', value: '99' } }); // temp
        client.send({ msg: 'set_state', data: { id: 'nope_42', value: 'true' } });
        await sleep(150);
        expect(client.frames.filter((f) => f.msg === 'event')).toEqual([]);
    });

    it('is ignored before login', async () => {
        const c = createClient();
        await c.opened;
        c.send({ msg: 'set_state', data: { id: 'output_1', value: 'false' } });
        await sleep(150);
        expect(c.frames).toEqual([]);
    });
});

describe('set_state transitions', () => {
    const io = (gui_type, state) => ({ gui_type, state });

    const cases = [
        // [gui_type, current state, sent value, expected next state]
        ['light', 'true', 'false', 'false'],
        ['light', 'false', 'true', 'true'],
        ['var_bool', 'false', 'true', 'true'],

        ['light_dimmer', 'set 50', 'set 30', '30'],
        ['light_dimmer', '30', 'true', '100'],
        ['light_dimmer', '30', 'false', '0'],
        ['light_dimmer', '30', 'set 999', '100'], // clamped
        ['light_dimmer', '30', 'set -5', '0'], // clamped

        ['light_rgb', '#ff2200', 'set #00ff00', '#00ff00'],
        ['light_rgb', '#ff2200', 'false', '#000000'],
        ['light_rgb', '0', 'true', '#ffffff'], // no colour remembered yet
        ['light_rgb', '#ff2200', 'true', '#ff2200'], // already lit: unchanged

        ['shutter', 'false', 'up', 'true'],
        ['shutter', 'true', 'down', 'false'],
        ['shutter', 'true', 'stop', null], // freeze, no observable change

        ['shutter_smart', 'up 100', 'down', 'down 100'],
        ['shutter_smart', 'down 35', 'up', 'up 0'],
        ['shutter_smart', 'down 35', 'stop', 'stop 35'],
        ['shutter_smart', 'down 35', 'set 70', 'stop 70'],

        ['var_int', '7', 'inc', '8'],
        ['var_int', '7', 'dec', '6'],
        ['analog_out', '20', 'inc', '21'],
        ['analog_out', '20', 'dec', '19'],

        ['var_string', '', 'hello world', 'hello world'],
        ['string_out', 'Bonne nuit', 'Bonjour', 'Bonjour'],

        ['scenario', 'false', 'true', null], // fire and forget
        ['temp', '21.5', '30', null],
        ['analog_in', '412', '0', null],
        ['string_in', '07:15', 'x', null],
        ['what_is_this', 'x', 'true', null],
    ];

    it.each(cases)('%s: %j + %j -> %j', (guiType, state, value, expected) => {
        expect(nextState(io(guiType, state), value)).toBe(expected);
    });

    it('restores the last lit colour when an rgb IO is switched back on', async () => {
        const { client } = await login();
        // output_3 starts at #ff2200
        client.send({ msg: 'set_state', data: { id: 'output_3', value: 'false' } });
        expect((await client.waitFor(ioChangedFor('output_3'))).data.data.state).toBe('#000000');

        client.send({ msg: 'set_state', data: { id: 'output_3', value: 'true' } });
        expect((await client.waitFor(ioChangedFor('output_3'))).data.data.state).toBe('#ff2200');
    });
});

describe('/control', () => {
    it('answers GET with a status snapshot (the readiness probe)', async () => {
        const res = await fetch(server.controlUrl);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('application/json');
        const body = await res.json();
        expect(body).toMatchObject({ ok: true, service: 'calaos-mock-server', port: server.port });
    });

    it('push_io broadcasts io_changed to every client', async () => {
        const { client: a } = await login();
        const { client: b } = await login();

        const { status, body } = await control({ op: 'push_io', id: 'input_1', state: '30.5' });
        expect(status).toBe(200);
        expect(body).toMatchObject({ ok: true, known: true });

        for (const c of [a, b]) {
            const event = await c.waitFor(ioChangedFor('input_1'));
            expect(event.data.data.state).toBe('30.5');
        }

        // ...and it sticks, even though temp is read-only over the protocol.
        a.send({ msg: 'get_home' });
        const home = await a.waitFor(isGetHome);
        const io = home.data.home.flatMap((r) => r.items).find((i) => i.id === 'input_1');
        expect(io.state).toBe('30.5');
    });

    it('push_io on an unknown id still broadcasts, flagged as unknown', async () => {
        const { client } = await login();
        const { body } = await control({ op: 'push_io', id: 'ghost_1', state: 'true' });
        expect(body.known).toBe(false);
        await expect(client.waitFor(ioChangedFor('ghost_1'))).resolves.toBeTruthy();
    });

    it('push_io rejects a missing id', async () => {
        const { status } = await control({ op: 'push_io', state: 'true' });
        expect(status).toBe(400);
    });

    it('drop destroys every open socket', async () => {
        const { client: a } = await login();
        const { client: b } = await login();

        const { body } = await control({ op: 'drop' });
        expect(body).toMatchObject({ ok: true, dropped: 2 });

        // terminate() means an abnormal close (1006), which is what drives the
        // client's reconnect path.
        await expect(a.closed).resolves.toBe(1006);
        await expect(b.closed).resolves.toBe(1006);

        const status = await (await fetch(server.controlUrl)).json();
        expect(status.clients).toBe(0);
    });

    it('log records every received frame in order, with the raw text', async () => {
        const { client } = await login();
        const setState = { msg: 'set_state', data: { id: 'output_1', value: 'false' } };
        client.send({ msg: 'get_home' });
        client.send(setState);
        await client.waitFor(ioChangedFor('output_1'));

        const { body } = await control({ op: 'log' });
        expect(body.log.map((e) => e.frame.msg)).toEqual(['login', 'get_home', 'set_state']);
        expect(body.log.map((e) => e.seq)).toEqual([0, 1, 2]);

        const last = body.log.at(-1);
        expect(last.frame).toEqual(setState); // E2E asserts exact set_state frames
        expect(JSON.parse(last.raw)).toEqual(setState);

        // clientId is a per-socket counter for the lifetime of the process
        // (reset does not renumber live sockets), so only its stability matters.
        const ids = new Set(body.log.map((e) => e.clientId));
        expect(ids.size).toBe(1);
        expect(typeof [...ids][0]).toBe('number');
    });

    it('log keeps unparseable frames with frame:null', async () => {
        const c = createClient();
        await c.opened;
        c.ws.send('}{');
        await sleep(100);
        const { body } = await control({ op: 'log' });
        expect(body.log).toHaveLength(1);
        expect(body.log[0]).toMatchObject({ raw: '}{', frame: null });
    });

    it('latency delays outgoing frames', async () => {
        await control({ op: 'latency', ms: 250 });
        const c = createClient();
        await c.opened;
        const started = Date.now();
        c.send({ msg: 'login', data: { cn_user: 'demo', cn_pass: 'demo' } });
        await c.waitFor(isLogin);
        expect(Date.now() - started).toBeGreaterThanOrEqual(200);
    });

    it('latency rejects a negative delay', async () => {
        const { status } = await control({ op: 'latency', ms: -1 });
        expect(status).toBe(400);
    });

    it('reset reloads the fixture state and clears the log, scenario and latency', async () => {
        const { client } = await login();
        client.send({ msg: 'set_state', data: { id: 'output_1', value: 'false' } });
        await client.waitFor(ioChangedFor('output_1'));
        await control({ op: 'scenario', name: 'reject_all_logins' });
        await control({ op: 'latency', ms: 120 });

        expect((await control({ op: 'reset' })).body).toMatchObject({ ok: true });

        const status = await (await fetch(server.controlUrl)).json();
        expect(status).toMatchObject({ scenario: null, latencyMs: 0, logSize: 0 });
        expect((await control({ op: 'log' })).body.log).toEqual([]);

        // Fresh client, because reset does not drop existing sockets.
        const { client: after, reply } = await login();
        expect(reply.data.success).toBe('true'); // scenario really is gone
        after.send({ msg: 'get_home' });
        const home = await after.waitFor(isGetHome);
        expect(home.data).toEqual(FIXTURE); // fixture state restored
    });

    it('rejects unknown ops and bad JSON', async () => {
        const unknown = await control({ op: 'teleport' });
        expect(unknown.status).toBe(400);
        expect(unknown.body.known).toContain('push_io');

        const bad = await fetch(server.controlUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{oops',
        });
        expect(bad.status).toBe(400);
    });
});

describe('/control scenarios', () => {
    it('login_fail_once refuses exactly one login', async () => {
        await control({ op: 'scenario', name: 'login_fail_once' });
        expect((await login()).reply.data.success).toBe('false');
        expect((await login()).reply.data.success).toBe('true');
        expect((await login()).reply.data.success).toBe('true');
    });

    it('reject_all_logins refuses every login', async () => {
        await control({ op: 'scenario', name: 'reject_all_logins' });
        expect((await login()).reply.data.success).toBe('false');
        expect((await login()).reply.data.success).toBe('false');
    });

    it('silent_login never answers', async () => {
        await control({ op: 'scenario', name: 'silent_login' });
        const c = createClient();
        await c.opened;
        c.send({ msg: 'login', data: { cn_user: 'demo', cn_pass: 'demo' } });
        await sleep(200);
        expect(c.frames).toEqual([]);
        // The frame was still received and logged.
        expect((await control({ op: 'log' })).body.log).toHaveLength(1);
    });

    it('scenario reset clears the active scenario', async () => {
        await control({ op: 'scenario', name: 'reject_all_logins' });
        expect((await login()).reply.data.success).toBe('false');
        await control({ op: 'scenario', name: 'reset' });
        expect((await login()).reply.data.success).toBe('true');
    });

    it('rejects an unknown scenario name', async () => {
        const { status, body } = await control({ op: 'scenario', name: 'explode' });
        expect(status).toBe(400);
        expect(body.known).toEqual([
            'login_fail_once',
            'silent_login',
            'reject_all_logins',
            'reset',
        ]);
    });
});

describe('camera snapshot endpoint', () => {
    it('returns image/png with valid credentials', async () => {
        const res = await fetch(cameraUrl('camera_1'));
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('image/png');
        const bytes = Buffer.from(await res.arrayBuffer());
        expect(bytes.equals(CAMERA_PNG)).toBe(true);
    });

    it('serves every camera in the fixture', async () => {
        for (const cam of FIXTURE.cameras) {
            expect((await fetch(cameraUrl(cam.id))).status).toBe(200);
        }
    });

    it('403s on a wrong password', async () => {
        expect((await fetch(cameraUrl('camera_1', 'demo', 'nope'))).status).toBe(403);
    });

    it('403s when credentials are missing', async () => {
        const res = await fetch(`${server.url}/api?action=camera&type=get_picture&id=camera_1`);
        expect(res.status).toBe(403);
    });

    it('404s on an unknown camera id', async () => {
        expect((await fetch(cameraUrl('camera_99'))).status).toBe(404);
    });

    it('400s on an unsupported camera action', async () => {
        const res = await fetch(`${cameraUrl('camera_1')}`.replace('get_picture', 'get_video'));
        expect(res.status).toBe(400);
    });
});

describe('http routing', () => {
    it('404s unknown paths', async () => {
        expect((await fetch(`${server.url}/nope`)).status).toBe(404);
    });

    it('400s a plain GET on /api', async () => {
        expect((await fetch(`${server.url}/api`)).status).toBe(400);
    });

    it('refuses a WebSocket upgrade outside /api', async () => {
        const c = createClient(`ws://127.0.0.1:${server.port}/socket`);
        await expect(c.opened).rejects.toThrow();
    });
});
