// `rescue_status`, `snapshots_list`, `snapshot_boot` and `snapshot_rollback`
// of the fake daemon (calaos_base docs/08_http_api.md, calaos-container
// docs/API.md "Snapshots and rescue"). Booting a snapshot or rolling back
// answers first, then the box reboots: every socket and session goes away
// and the box comes back in rescue (boot) or normal mode (rollback).

const ID_MAX = 2_147_483_647;
const ACTIONS = ['rescue_status', 'snapshots_list', 'snapshot_boot', 'snapshot_rollback'];

/** Newest first, the daemon's order, nothing filtered out. */
function fixture(now) {
    const day = 86_400_000;
    const date = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+00:00');
    return [
        { id: 145, date: date(now - 2 * 3_600_000), type: 'post', description: 'apt upgrade', current: false, default: false, bootable: true },
        { id: 144, date: date(now - 2 * 3_600_000 - 60_000), type: 'pre', description: 'apt upgrade', current: false, default: false, bootable: true },
        { id: 143, date: '', type: 'single', description: '', current: false, default: false, bootable: true },
        {
            id: 142,
            date: date(now - 6 * day),
            type: 'single',
            description:
                'Manual snapshot before the migration of the zigbee2mqtt network and the replacement of the main coordinator stick',
            current: false,
            default: false,
            bootable: true,
        },
        { id: 139, date: date(now - 20 * day), type: 'post', description: 'apt upgrade', current: false, default: false, bootable: false },
        { id: 1, date: date(now - 90 * day), type: 'single', description: 'first boot', current: true, default: true, bootable: true },
    ];
}

export function createSnapshots({ hub, failure, running }) {
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
        state = {
            /** The snapshot the box runs in rescue mode, or false. */
            rescue: false,
            empty: false,
            rows: fixture(Date.now()),
            /** `<action>` to a code, until cleared. */
            fail: new Map(),
            /** Same, for the next call only. */
            failOnce: new Map(),
            /** Ids the daemon refuses as `snapshot_too_old`. */
            tooOld: new Set(),
            /** The next boot or rollback answers `outcome: unknown`; true = it did run. */
            unknownOutcome: null,
            delayMs: 0,
            rebootMs: 1000,
            calls: [],
            reboots: 0,
        };
    }
    reset();

    function view() {
        if (state.empty) return { booted: null, snapshots: [], apt_snapshots: true };
        if (state.rescue === false) return { booted: { id: 1 }, snapshots: state.rows.map((row) => ({ ...row })), apt_snapshots: true };
        const snapshots = state.rows.map((row) => ({
            ...row,
            bootable: false,
            current: row.id === state.rescue,
        }));
        return { booted: { id: state.rescue }, snapshots, apt_snapshots: true };
    }

    function rescueStatus() {
        if (state.rescue === false) return { rescue: false, overlay: false, snapshot: null };
        return { rescue: true, overlay: true, snapshot: state.rescue };
    }

    /** Called by `system_reboot`: in rescue mode, a plain reboot is the way back. */
    function rebooted() {
        if (state.rescue === false) return;
        state.reboots += 1;
        later(state.rebootMs, () => leave(false));
    }

    function leave(rescue) {
        state.rescue = rescue;
        hub.dropClients();
    }

    function takesFailure(action) {
        if (state.failOnce.has(action)) {
            const code = state.failOnce.get(action);
            state.failOnce.delete(action);
            return code;
        }
        return state.fail.get(action) ?? null;
    }

    function unknown() {
        return failure('daemon_unreachable', 'no answer from the daemon in time', { outcome: 'unknown' });
    }

    function target(params) {
        const id = params.id;
        if (typeof id !== 'number' || !Number.isInteger(id) || id < 1 || id > ID_MAX) {
            return { error: failure('invalid_request', 'invalid snapshot id') };
        }
        const row = state.rows.find((entry) => entry.id === id);
        if (row === undefined) return { error: failure('invalid_snapshot', 'no such snapshot') };
        return { id, row };
    }

    function boot(params) {
        if (running()) return failure('upgrade_in_progress', 'upgrade already in progress');
        const found = target(params);
        if (found.error !== undefined) return found.error;
        if (state.rescue !== false) return failure('in_rescue', 'already booted on a snapshot');
        if (!found.row.bootable) return failure('not_bootable', 'snapshot has no boot entry');
        if (state.tooOld.has(found.id)) return failure('snapshot_too_old', 'snapshot predates the rescue support');
        state.calls.push({ action: 'snapshot_boot', id: found.id });
        return reboot(() => leave(found.id));
    }

    function rollback() {
        if (running()) return failure('upgrade_in_progress', 'upgrade already in progress');
        if (state.rescue === false) return failure('not_in_rescue', 'not booted on a snapshot');
        state.calls.push({ action: 'snapshot_rollback', id: state.rescue });
        return reboot(() => leave(false));
    }

    /** The reply comes first (or `outcome: unknown` when told), the reboot runs regardless. */
    function reboot(done) {
        const told = state.unknownOutcome;
        state.unknownOutcome = null;
        if (told !== 'unapplied') {
            state.reboots += 1;
            later(state.rebootMs, done);
        }
        return told === null ? { success: 'true', result: null } : unknown();
    }

    function handle(action, session, params) {
        if (!ACTIONS.includes(action)) return undefined;
        const code = takesFailure(action);
        if (code !== null) return failure(code, `${action} refused`);
        switch (action) {
            case 'rescue_status':
                return { success: 'true', result: rescueStatus() };
            case 'snapshots_list':
                return { success: 'true', result: view() };
            case 'snapshot_boot':
                return boot(params);
            default:
                return rollback();
        }
    }

    function delay(action) {
        return ACTIONS.includes(action) ? state.delayMs : 0;
    }

    /**
     * `/control {op:'admin', snapshots:{rescue, empty, fail, failOnce, tooOld,
     * unknownOutcome, delayMs, rebootMs}}`; `rescue` is a snapshot id or false,
     * `fail` and `failOnce` map an action to an error code (null clears it).
     */
    function configure(patch) {
        if (patch.rescue !== undefined) {
            if (patch.rescue !== false && !state.rows.some((row) => row.id === patch.rescue)) return `unknown snapshot '${patch.rescue}'`;
            state.rescue = patch.rescue;
        }
        if (patch.empty !== undefined) state.empty = Boolean(patch.empty);
        for (const key of ['fail', 'failOnce']) {
            if (typeof patch[key] !== 'object' || patch[key] === null) continue;
            for (const [action, code] of Object.entries(patch[key])) {
                if (!ACTIONS.includes(action)) return `unknown action '${action}'`;
                if (code === null) state[key].delete(action);
                else state[key].set(action, String(code));
            }
        }
        if (Array.isArray(patch.tooOld)) state.tooOld = new Set(patch.tooOld.map(Number));
        if (patch.unknownOutcome !== undefined) {
            state.unknownOutcome = patch.unknownOutcome === 'unapplied' ? 'unapplied' : patch.unknownOutcome ? 'applied' : null;
        }
        if (patch.delayMs !== undefined) state.delayMs = Math.max(0, Number(patch.delayMs) || 0);
        if (patch.rebootMs !== undefined) state.rebootMs = Math.max(0, Number(patch.rebootMs) || 0);
        return null;
    }

    function status() {
        return {
            rescue: state.rescue,
            calls: state.calls.map((call) => ({ ...call })),
            reboots: state.reboots,
        };
    }

    return { reset, handle, delay, rebooted, configure, status };
}
