// `services_list` / `services_restart` of the fake daemon (calaos-container
// docs/API.md "Services"). A restart answers first, then goes `activating`
// after 500 ms and `active` (or `failed`) after `restartMs`; restarting
// calaos-server drops every socket, as the real one does.

const SERVICE_ID = /^[a-z0-9-]{1,32}$/;
/** The daemon answers first, then restarts the unit about this much later. */
const RESTART_DELAY_MS = 500;

const TABLE = [
    ['calaos-server', 'calaos-server.service', 'service', true],
    ['calaos-home', 'calaos-home.service', 'service', true],
    ['mosquitto', 'mosquitto.service', 'service', true],
    ['zigbee2mqtt', 'zigbee2mqtt.service', 'service', true],
    ['influxdb', 'influxdb.service', 'service', true],
    ['grafana', 'grafana.service', 'service', true],
    ['hue2mqtt', 'hue2mqtt.service', 'service', true],
    ['envoy', 'envoy.service', 'service', true],
    ['olad', 'olad.service', 'service', true],
    ['timesyncd', 'systemd-timesyncd.service', 'service', true],
    ['calaos-ddns', 'calaos-ddns.service', 'oneshot', true],
    ['calaos-container', 'calaos-container.service', 'service', false],
    ['haproxy', 'haproxy.service', 'service', false],
    ['networkd', 'systemd-networkd.service', 'service', false],
    ['ssh', 'ssh.service', 'service', false],
];

/** Not installed on the mock box. */
const NOT_FOUND = ['hue2mqtt', 'olad'];

function iso(ms) {
    return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function createServices({ hub, failure, running }) {
    let state;
    const timers = new Set();

    function later(ms, fn) {
        const handle = setTimeout(() => {
            timers.delete(handle);
            fn();
        }, ms);
        timers.add(handle);
    }

    function reset() {
        for (const handle of timers) clearTimeout(handle);
        timers.clear();
        const bootedAt = Date.now() - 3 * 86_400_000;
        state = {
            units: new Map(
                TABLE.map(([id, unit, kind, restartable]) => {
                    const missing = NOT_FOUND.includes(id);
                    const oneshot = kind === 'oneshot';
                    return [
                        id,
                        {
                            id,
                            unit,
                            kind,
                            restartable,
                            active_state: missing ? 'not-found' : oneshot ? 'inactive' : 'active',
                            sub_state: missing ? '' : oneshot ? 'dead' : 'running',
                            enabled: missing ? '' : oneshot ? 'static' : 'enabled',
                            since: missing ? null : iso(oneshot ? Date.now() - 3_600_000 : bootedAt),
                        },
                    ];
                }),
            ),
            restartMs: 3000,
            /** Ids whose next restart ends `failed`. */
            fail: new Set(),
            /** Restarting calaos-server drops every socket. */
            dropOnSelfRestart: true,
            restarts: [],
        };
    }
    reset();

    function list() {
        return { services: [...state.units.values()].map((entry) => ({ ...entry })) };
    }

    function restart(params) {
        const id = params.unit;
        if (typeof id !== 'string' || !SERVICE_ID.test(id)) return failure('invalid_request', 'invalid unit');
        const entry = state.units.get(id);
        if (entry === undefined || !entry.restartable) {
            return failure('invalid_request', 'unknown or non-restartable service');
        }
        if (running()) return failure('upgrade_in_progress', 'upgrade already in progress');
        state.restarts.push(id);
        later(RESTART_DELAY_MS, () => {
            if (entry.active_state === 'not-found') return;
            entry.active_state = 'activating';
            entry.sub_state = 'start';
            if (id === 'calaos-server' && state.dropOnSelfRestart) hub.dropClients();
        });
        later(RESTART_DELAY_MS + state.restartMs, () => {
            if (entry.active_state === 'not-found') return;
            if (state.fail.has(id)) {
                state.fail.delete(id);
                entry.active_state = 'failed';
                entry.sub_state = 'failed';
                return;
            }
            const oneshot = entry.kind === 'oneshot';
            entry.active_state = oneshot ? 'inactive' : 'active';
            entry.sub_state = oneshot ? 'dead' : 'running';
            entry.since = iso(Date.now());
        });
        return { success: 'true', result: { id, state: 'restarting' } };
    }

    function handle(action, session, params) {
        if (action === 'services_list') return { success: 'true', result: list() };
        if (action === 'services_restart') return restart(params);
        return undefined;
    }

    /** `/control {op:'admin', services:{restartMs, fail, state, dropOnSelfRestart}}`. */
    function configure(patch) {
        if (patch.restartMs !== undefined) state.restartMs = Number(patch.restartMs);
        if (typeof patch.fail === 'string') state.fail.add(patch.fail);
        if (patch.dropOnSelfRestart !== undefined) state.dropOnSelfRestart = Boolean(patch.dropOnSelfRestart);
        if (typeof patch.state === 'object' && patch.state !== null) {
            for (const [id, activeState] of Object.entries(patch.state)) {
                const entry = state.units.get(id);
                if (entry === undefined) return `unknown service '${id}'`;
                entry.active_state = activeState;
                entry.sub_state = activeState === 'not-found' ? '' : activeState === 'active' ? 'running' : 'dead';
            }
        }
        return null;
    }

    function status() {
        return { restarts: [...state.restarts] };
    }

    return { reset, handle, configure, status };
}
