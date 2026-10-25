// @vitest-environment node
//
// The phase-3 admin features of the mock calaos_server (services, logs,
// time, config, network), driven over a raw `ws` client like
// mock-server.test.mjs.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { startServer } from './index.mjs';

/** @type {Awaited<ReturnType<typeof startServer>>} */
let server;
let sockets = [];

beforeAll(async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
});

afterAll(async () => {
    await server.close();
});

afterEach(async () => {
    for (const ws of sockets) ws.terminate();
    sockets = [];
    await control({ op: 'reset' });
});

async function control(body) {
    const res = await fetch(server.controlUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    return res.json();
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A signed-in socket, an unlocked session and an `ask(action, params)` helper. */
async function session() {
    const ws = new WebSocket(server.wsUrl);
    sockets.push(ws);
    const frames = [];
    ws.on('message', (data) => frames.push(JSON.parse(data.toString())));
    await new Promise((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
    });
    let seq = 0;
    const waitFor = async (pred, timeout = 2000) => {
        const until = Date.now() + timeout;
        for (;;) {
            const hit = frames.find(pred);
            if (hit !== undefined) {
                frames.splice(frames.indexOf(hit), 1);
                return hit;
            }
            if (Date.now() > until) throw new Error(`timed out; received ${JSON.stringify(frames)}`);
            await sleep(10);
        }
    };
    const raw = async (msg, data) => {
        seq += 1;
        const msgId = String(seq);
        ws.send(JSON.stringify({ msg, msg_id: msgId, data }));
        return (await waitFor((f) => f.msg === msg && f.msg_id === msgId)).data;
    };
    await raw('login', { cn_user: 'demo', cn_pass: 'demo' });
    await control({ op: 'admin', password: 'correct horse battery' });
    const unlocked = await raw('admin_unlock', { admin_pass: 'correct horse battery' });
    const token = unlocked.admin_session;
    const ask = (action, params) => raw('admin', { action, admin_session: token, ...(params === undefined ? {} : { params }) });
    return { ws, ask, token, waitFor, frames };
}

describe('services', () => {
    it('lists the fifteen ids in the daemon order, with typed fields', async () => {
        const { ask } = await session();
        const reply = await ask('services_list');
        expect(reply.success).toBe('true');
        const ids = reply.result.services.map((s) => s.id);
        expect(ids.slice(0, 2)).toEqual(['calaos-server', 'calaos-home']);
        expect(ids).toHaveLength(15);
        const ssh = reply.result.services.find((s) => s.id === 'ssh');
        expect(ssh.restartable).toBe(false);
        expect(reply.result.services.find((s) => s.id === 'olad').active_state).toBe('not-found');
    });

    it('restarts through activating to active, or failed when told', async () => {
        const { ask } = await session();
        await control({ op: 'admin', services: { restartMs: 100, fail: 'grafana' } });
        expect((await ask('services_restart', { unit: 'mosquitto' })).result).toEqual({ id: 'mosquitto', state: 'restarting' });
        await ask('services_restart', { unit: 'grafana' });
        await sleep(550);
        const during = (await ask('services_list')).result.services;
        expect(during.find((s) => s.id === 'mosquitto').active_state).toBe('activating');
        await sleep(200);
        const after = (await ask('services_list')).result.services;
        expect(after.find((s) => s.id === 'mosquitto').active_state).toBe('active');
        expect(after.find((s) => s.id === 'grafana').active_state).toBe('failed');
    });

    it('refuses a status-only id and a malformed one', async () => {
        const { ask } = await session();
        expect((await ask('services_restart', { unit: 'haproxy' })).error).toBe('invalid_request');
        expect((await ask('services_restart', { unit: 'Mosquitto.service' })).error).toBe('invalid_request');
    });

    it('drops every socket when calaos-server restarts', async () => {
        const { ws, ask } = await session();
        await control({ op: 'admin', services: { restartMs: 50 } });
        const closed = new Promise((resolve) => ws.once('close', resolve));
        await ask('services_restart', { unit: 'calaos-server' });
        await closed;
    });
});

describe('logs', () => {
    it('lists seventeen sources', async () => {
        const { ask } = await session();
        const reply = await ask('logs_sources');
        expect(reply.result.sources).toHaveLength(17);
        expect(reply.result.sources.at(-1)).toEqual({ id: 'system', label: 'Whole system' });
    });

    it('pages backward by cursor, oldest first in each page, without overlap', async () => {
        const { ask } = await session();
        const first = (await ask('logs_query', { lines: 50 })).result;
        expect(first.entries).toHaveLength(50);
        expect(first.complete).toBe(true);
        const ts = first.entries.map((e) => Date.parse(e.ts));
        expect([...ts].sort((a, b) => a - b)).toEqual(ts);
        expect(first.next_cursor).toBe(first.entries[0].cursor);
        await sleep(1100);
        const older = (await ask('logs_query', { lines: 50, cursor: first.next_cursor, direction: 'backward' })).result;
        expect(older.entries).toHaveLength(50);
        expect(Date.parse(older.entries.at(-1).ts)).toBeLessThanOrEqual(ts[0]);
        expect(older.entries.map((e) => e.cursor)).not.toContain(first.entries[0].cursor);
    });

    it('follows forward from the newest cursor as live lines arrive', async () => {
        const { ask } = await session();
        const first = (await ask('logs_query', { lines: 10 })).result;
        await sleep(2100);
        const next = (await ask('logs_query', { cursor: first.entries.at(-1).cursor, direction: 'forward' })).result;
        expect(next.entries.length).toBeGreaterThanOrEqual(2);
        expect(next.entries.length).toBeLessThanOrEqual(9);
        expect(next.next_cursor).toBe(next.entries.at(-1).cursor);
    });

    it('filters by source, priority and masked text', async () => {
        const { ask } = await session();
        const reply = (await ask('logs_query', { sources: ['kernel'], priority: 'err', lines: 20 })).result;
        expect(reply.entries.length).toBeGreaterThan(0);
        expect(reply.entries.every((e) => e.source === 'kernel' && e.priority <= 3)).toBe(true);
        await sleep(1100);
        const masked = (await ask('logs_query', { text: 'cn_pass=***', lines: 5 })).result;
        expect(masked.entries.length).toBeGreaterThan(0);
        expect(masked.entries.every((e) => e.message.includes('cn_pass=***'))).toBe(true);
    });

    it('refuses what calaos_server refuses, and rate-limits at 2 a second', async () => {
        const { ask } = await session();
        expect((await ask('logs_query', { priority: '3' })).error).toBe('invalid_request');
        expect((await ask('logs_query', { lines: '20' })).error).toBe('invalid_request');
        expect((await ask('logs_query', { direction: 'forward' })).error).toBe('invalid_request');
        await ask('logs_query', { lines: 1 });
        await ask('logs_query', { lines: 1 });
        const third = await ask('logs_query', { lines: 1 });
        expect(third).toMatchObject({ error: 'rate_limited', retry_after: '1' });
    });
});

describe('time', () => {
    it('reads, then changes the zone with restart_required', async () => {
        const { ask } = await session();
        expect((await ask('time_get')).result).toMatchObject({ timezone: 'Europe/Paris', ntp: true, synchronized: true });
        expect((await ask('time_zones')).result.timezones).toContain('UTC');
        const set = (await ask('time_set', { timezone: 'UTC' })).result;
        expect(set).toMatchObject({ timezone: 'UTC', restart_required: true });
    });

    it('refuses a time while NTP is on, and reports a partial failure', async () => {
        const { ask } = await session();
        expect((await ask('time_set', { time: '2026-10-25T09:00:00Z' })).msg).toBe('ntp is active');
        await control({ op: 'admin', time: { failStep: 'ntp' } });
        const failed = await ask('time_set', { timezone: 'UTC', ntp: false });
        expect(failed).toMatchObject({ error: 'internal', applied: 'timezone', failed: 'ntp', restart_required: 'true' });
    });
});

describe('config', () => {
    it('never sends a secret value', async () => {
        const { ask } = await session();
        const options = (await ask('config_list')).result.options;
        const secret = options.find((o) => o.key === 'smtp_password');
        expect(secret).toMatchObject({ secret: true, set: true });
        expect('value' in secret).toBe(false);
        const set = (await ask('config_set', { key: 'smtp_password', value: 'new' })).result;
        expect(set).toEqual({ key: 'smtp_password', set: true, restart_required: false });
    });

    it('validates through the registry and refuses keys off the list', async () => {
        const { ask } = await session();
        expect((await ask('config_set', { key: 'debug_level', value: '9' })).error).toBe('invalid_request');
        expect((await ask('config_set', { key: 'cn_pass', value: 'x' })).error).toBe('invalid_request');
        expect((await ask('config_set', { key: 'debug_level', value: '4' })).result).toEqual({
            key: 'debug_level',
            value: '4',
            restart_required: true,
        });
    });

    it('serves the HTTP backup as a download, and an error without a file', async () => {
        const { token } = await session();
        const post = (body) =>
            fetch(`${server.url}/api`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const ok = await post({ action: 'config_backup', cn_user: 'demo', cn_pass: 'demo', admin_session: token });
        expect(ok.headers.get('content-disposition')).toMatch(/^attachment; filename="calaos-backup-calaos-mock-\d{8}-\d{4}\.json"$/);
        expect(ok.headers.get('cache-control')).toBe('no-store');
        expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
        const doc = await ok.json();
        expect(doc.format).toBe('calaos-config-backup/1');
        expect(Object.keys(doc.files).sort()).toEqual(['io.xml', 'local_config.xml', 'rules.xml', 'widgets.xml']);
        const refused = await post({ action: 'config_backup', cn_user: 'demo', cn_pass: 'demo', admin_session: 'f'.repeat(64) });
        expect(refused.headers.get('content-disposition')).toBeNull();
        expect(await refused.json()).toMatchObject({ success: 'false', error: 'bad_session' });
    });
});

describe('network', () => {
    const change = { intf: 'eth0', dhcp: false, ipv4: '192.168.1.20/24', gateway: '192.168.1.1', dns_servers: ['192.168.1.1'] };

    async function codeFor(ask, params) {
        await control({ op: 'admin', approvers: ['0c1d2e3f4a5b6c7d'], codeIntervalMs: 0 });
        const ticket = (await ask('code_request', { code_action: 'network_config', code_params: params })).result;
        const pushed = (await control({ op: 'admin_status' })).pushed.find((p) => p.code_id === ticket.code_id);
        return { code_id: ticket.code_id, code: pushed.code };
    }

    it('applies with a code bound to the fields, then confirms', async () => {
        const { ask, waitFor } = await session();
        const proof = await codeFor(ask, change);
        const applied = await ask('network_apply', { ...change, ...proof });
        expect(applied.result).toMatchObject({ intf: 'eth0', confirm_within: 120 });
        const event = await waitFor((f) => f.msg === 'admin_event' && f.data.type === 'network_pending');
        expect(event.data.data.change_id).toBe(applied.result.change_id);
        const state = (await ask('network_state')).result;
        expect(state.pending).toMatchObject({ change_id: applied.result.change_id, intf: 'eth0' });
        expect(state.pending.expires_in).toBeGreaterThan(110);
        expect((await ask('network_confirm', { change_id: applied.result.change_id })).result.state).toBe('confirmed');
        expect((await ask('network_state')).result.pending).toBeNull();
    });

    it('refuses a code for other fields, and a second change while one is pending', async () => {
        const { ask } = await session();
        const proof = await codeFor(ask, change);
        expect((await ask('network_apply', { ...change, ipv4: '192.168.1.21/24', ...proof })).error).toBe('bad_code');
        const good = await codeFor(ask, change);
        await ask('network_apply', { ...change, ...good });
        const again = await codeFor(ask, change);
        const refused = await ask('network_apply', { ...change, ...again });
        expect(refused.error).toBe('network_pending');
        expect(refused.change_id).toMatch(/^[0-9a-f]{16}$/);
    });

    it('rolls back on expiry with the network_rolled_back event', async () => {
        const { ask, waitFor } = await session();
        await control({ op: 'admin', network: { confirmMs: 100 } });
        const proof = await codeFor(ask, change);
        await ask('network_apply', { ...change, ...proof });
        const event = await waitFor((f) => f.msg === 'admin_event' && f.data.type === 'network_rolled_back');
        expect(event.data.data).toEqual({ intf: 'eth0' });
        const eth0 = (await ask('network_state')).result.interfaces.find((i) => i.name === 'eth0');
        expect(eth0.ipv4).toBe('192.168.1.10/24');
    });

    it('validates as the server does before any code is spent', async () => {
        const { ask } = await session();
        await control({ op: 'admin', approvers: ['0c1d2e3f4a5b6c7d'] });
        const bad = (params) => ask('code_request', { code_action: 'network_config', code_params: params });
        expect((await bad({ intf: 'eth0', dhcp: false, ipv4: '192.168.1.20' })).error).toBe('invalid_request');
        expect((await bad({ intf: 'eth0', dhcp: 'false', ipv4: '192.168.1.20/24' })).error).toBe('invalid_request');
        expect((await bad({ intf: 'eth0', dhcp: true, ipv4: '192.168.1.20/24' })).error).toBe('invalid_request');
        expect((await bad({ intf: 'lo', dhcp: true })).error).toBe('invalid_request');
        expect((await bad({ intf: 'eth0', dhcp: false, ipv4: '192.168.01.20/24' })).error).toBe('invalid_request');
    });

    it('drops every socket after an apply when the address moves', async () => {
        const { ws, ask } = await session();
        await control({ op: 'admin', network: { dropOnApply: true } });
        const proof = await codeFor(ask, change);
        const closed = new Promise((resolve) => ws.once('close', resolve));
        await ask('network_apply', { ...change, ...proof });
        await closed;
    });
});
