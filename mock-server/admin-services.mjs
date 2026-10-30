// `services_list` and the five service verbs of the fake daemon (calaos_base
// docs/08_http_api.md "Services"). A verb answers first, then the unit
// changes state after 500 ms and settles after `restartMs`; restarting
// calaos-server or haproxy drops every socket, as the real ones do, and
// restarting calaos-container leaves the admin routes unreachable meanwhile.

const SERVICE_ID = /^[a-z0-9-]{1,32}$/;
/** The daemon answers first, then acts on the unit about this much later. */
const ACT_DELAY_MS = 500;

const ALL_VERBS = ['restart', 'start', 'stop', 'enable', 'disable'];
const RESTART_ONLY = ['restart'];
const VERBS = new Set(ALL_VERBS);

const TABLE = [
    ['calaos-server', 'calaos-server.service', RESTART_ONLY],
    ['calaos-home', 'calaos-home.service', ALL_VERBS],
    ['mosquitto', 'mosquitto.service', ALL_VERBS],
    ['zigbee2mqtt', 'zigbee2mqtt.service', ALL_VERBS],
    ['influxdb', 'influxdb.service', ALL_VERBS],
    ['grafana', 'grafana.service', ALL_VERBS],
    ['hue2mqtt', 'hue2mqtt.service', ALL_VERBS],
    ['envoy', 'envoy.service', ALL_VERBS],
    ['olad', 'olad.service', ALL_VERBS],
    ['ntp', 'chrony.service', RESTART_ONLY],
    ['calaos-container', 'calaos-container.service', RESTART_ONLY],
    ['haproxy', 'haproxy.service', RESTART_ONLY],
    ['networkd', 'systemd-networkd.service', []],
    ['ssh', 'ssh.service', RESTART_ONLY],
];

/** Not installed on the mock box. */
const NOT_FOUND = ['olad'];
/** The defaults of a real box: SSH turned off by masking, Zigbee2MQTT installed but off. */
const MASKED = ['hue2mqtt'];
const STOPPED = ['zigbee2mqtt'];

/** Every browser socket goes through these. */
const CONNECTION_IDS = ['calaos-server', 'haproxy'];
const DAEMON_ID = 'calaos-container';
/** `reload-or-restart` keeps the process, so `since` does not move. */
const RELOADED_IDS = ['ssh'];

const PENDING_STATE = {
    restart: 'restarting',
    start: 'starting',
    stop: 'stopping',
    enable: 'enabling',
    disable: 'disabling',
};

function iso(ms) {
    return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function initialUnit([id, unit, actions], bootedAt) {
    const row = { id, unit, boot_unit: unit, actions, restartable: actions.includes('restart') };
    if (NOT_FOUND.includes(id)) {
        return { ...row, active_state: 'not-found', sub_state: '', enabled: '', startup: '', since: null };
    }
    if (MASKED.includes(id)) {
        return { ...row, active_state: 'inactive', sub_state: 'dead', enabled: 'masked', startup: 'masked', since: null };
    }
    if (STOPPED.includes(id)) {
        return { ...row, active_state: 'inactive', sub_state: 'dead', enabled: 'disabled', startup: 'disabled', since: null };
    }
    return { ...row, active_state: 'active', sub_state: 'running', enabled: 'enabled', startup: 'enabled', since: iso(bootedAt) };
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
            units: new Map(TABLE.map((row) => [row[0], initialUnit(row, bootedAt)])),
            restartMs: 3000,
            /** Ids whose next verb ends `failed`. */
            fail: new Set(),
            /** `<id>:<verb>` pairs, for one verb only. */
            failVerb: new Set(),
            /** Restarting what carries the sockets drops every one of them. */
            dropOnSelfRestart: true,
            /** Refuses every verb as during a job this client did not see start. */
            upgradeInProgress: false,
            /** calaos-container is restarting: nothing answers on its socket. */
            daemonDown: false,
            restarts: [],
            actions: [],
        };
    }
    reset();

    function list() {
        return { services: [...state.units.values()].map((entry) => ({ ...entry })) };
    }

    function setActive(entry, active, sub) {
        entry.active_state = active;
        entry.sub_state = sub;
    }

    function setStartup(entry, startup) {
        entry.startup = startup;
        entry.enabled = startup;
    }

    function takesFailure(id, verb) {
        const pair = `${id}:${verb}`;
        const told = state.fail.has(id) || state.failVerb.has(pair);
        state.fail.delete(id);
        state.failVerb.delete(pair);
        return told;
    }

    function act(verb, params) {
        const id = params.unit;
        if (typeof id !== 'string' || !SERVICE_ID.test(id)) return failure('invalid_request', 'invalid unit');
        const entry = state.units.get(id);
        if (entry === undefined || !entry.actions.includes(verb)) {
            return failure('invalid_request', 'unknown service, or verb not offered for it');
        }
        if (running() || state.upgradeInProgress) return failure('upgrade_in_progress', 'upgrade already in progress');
        if (entry.startup === 'masked' || entry.active_state === 'not-found') {
            return failure('service_unavailable', 'unit masked or not installed');
        }
        state.actions.push({ unit: id, verb });
        if (verb === 'restart') state.restarts.push(id);

        const stopping = verb === 'stop' || verb === 'disable';
        // systemd keeps `failed` until `reset-failed`: stopping such a unit changes nothing.
        const staysFailed = stopping && entry.active_state === 'failed';
        later(ACT_DELAY_MS, () => {
            if (entry.active_state === 'not-found') return;
            if (verb === 'enable') setStartup(entry, 'enabled');
            if (verb === 'disable') setStartup(entry, 'disabled');
            if (staysFailed) return;
            if (stopping) setActive(entry, 'deactivating', 'stop-sigterm');
            else setActive(entry, 'activating', 'start');
            if (verb === 'restart' && CONNECTION_IDS.includes(id) && state.dropOnSelfRestart) hub.dropClients();
            if (verb === 'restart' && id === DAEMON_ID) state.daemonDown = true;
        });
        later(ACT_DELAY_MS + state.restartMs, () => {
            if (id === DAEMON_ID) state.daemonDown = false;
            if (entry.active_state === 'not-found' || staysFailed) return;
            if (takesFailure(id, verb)) {
                setActive(entry, 'failed', 'failed');
            } else if (stopping) {
                setActive(entry, 'inactive', 'dead');
            } else {
                setActive(entry, 'active', 'running');
                if (!RELOADED_IDS.includes(id)) entry.since = iso(Date.now());
            }
        });
        return { success: 'true', result: { id, state: PENDING_STATE[verb] } };
    }

    function handle(action, session, params) {
        if (action !== 'services_list' && !action.startsWith('services_')) return undefined;
        if (state.daemonDown) return failure('daemon_unreachable', 'calaos-container unreachable');
        if (action === 'services_list') return { success: 'true', result: list() };
        const verb = action.slice('services_'.length);
        return VERBS.has(verb) ? act(verb, params) : undefined;
    }

    /**
     * `/control {op:'admin', services:{restartMs, fail, fail_service:{unit, verb},
     * state, startup, dropOnSelfRestart, upgradeInProgress}}`.
     */
    function configure(patch) {
        if (patch.upgradeInProgress !== undefined) state.upgradeInProgress = Boolean(patch.upgradeInProgress);
        if (patch.restartMs !== undefined) state.restartMs = Number(patch.restartMs);
        if (typeof patch.fail === 'string') state.fail.add(patch.fail);
        if (typeof patch.fail_service === 'object' && patch.fail_service !== null) {
            state.failVerb.add(`${patch.fail_service.unit}:${patch.fail_service.verb}`);
        }
        if (patch.dropOnSelfRestart !== undefined) state.dropOnSelfRestart = Boolean(patch.dropOnSelfRestart);
        if (typeof patch.state === 'object' && patch.state !== null) {
            for (const [id, activeState] of Object.entries(patch.state)) {
                const entry = state.units.get(id);
                if (entry === undefined) return `unknown service '${id}'`;
                const sub = activeState === 'not-found' ? '' : activeState === 'active' ? 'running' : 'dead';
                setActive(entry, activeState, sub);
            }
        }
        if (typeof patch.startup === 'object' && patch.startup !== null) {
            for (const [id, startup] of Object.entries(patch.startup)) {
                const entry = state.units.get(id);
                if (entry === undefined) return `unknown service '${id}'`;
                setStartup(entry, startup);
            }
        }
        return null;
    }

    function status() {
        return { restarts: [...state.restarts], actions: state.actions.map((item) => ({ ...item })) };
    }

    return { reset, handle, configure, status };
}
