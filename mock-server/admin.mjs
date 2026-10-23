// Admin side of the mock calaos_server: `admin_unlock`, `admin_set`, `admin`,
// `admin_event`, and `settings` / `change_cred` — the contract of calaos_base
// docs/08_http_api.md "Administration", with a fake daemon behind it.
//
// Everything in an error payload is a STRING; the `result` of an `admin`
// reply is the daemon's JSON with its real types, copied verbatim.
//
// The upgrade is a timer: `total_percent` climbs in steps of 10 over
// `upgradeMs`, publishing `upgrade_progress` events; `dropAtPercent` kills
// every socket once on the way (calaos-server restarting itself) and
// `failAtPercent` ends the run in error. Driven from `/control {op:'admin'}`.

import { randomBytes } from 'node:crypto';

export const ADMIN_SCENARIOS = [
    'unavailable',
    'old_server',
    'daemon_too_old',
    'https_required',
    'daemon_unreachable',
];

const ACTIONS = [
    'update_status',
    'update_check',
    'update_available',
    'update_upgrade_all',
    'update_upgrade',
    'system_reboot',
    'system_restart',
    'system_info',
    'mcp_regenerate',
];

const SESSION_SECONDS = 900;
const MIN_PASSWORD_LENGTH = 10;
/** Daemon limiter: about 5 failures per minute. */
const RATE_LIMIT_FAILURES = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

const DEFAULT_UPDATES = {
    'calaos-server': { name: 'calaos-server', version: '4.6.0', current_version: '4.5.0' },
    'calaos-container': { name: 'calaos-container', version: '1.4.0', current_version: '1.3.2' },
};

function idleProgress() {
    return {
        status: 'idle',
        total_percent: 0,
        current_pkg: '',
        current_step: '',
        current_percent: 0,
        pkg_index: 0,
        pkg_count: 0,
        packages: [],
        message: '',
        error: '',
    };
}

function failure(error, msg, extra = {}) {
    return { success: 'false', error, msg, ...extra };
}

export function createAdmin({ hub, send, broadcast, withMsgId }) {
    let state;
    let timer = null;

    function reset() {
        if (timer !== null) clearInterval(timer);
        timer = null;
        state = {
            set: false,
            password: '',
            /** token → expiry (ms epoch). */
            sessions: new Map(),
            apiAllowedHosts: '',
            scenario: null,
            /** Timestamps of recent unlock failures (rate limiter). */
            failures: [],
            updates: structuredClone(DEFAULT_UPDATES),
            upgradeMs: 2000,
            dropAtPercent: null,
            failAtPercent: null,
            rebootRequired: false,
            dropped: false,
            progress: idleProgress(),
            job: null,
            /** Counters the tests read back. */
            reboots: 0,
            restarts: 0,
            mcpRegenerations: 0,
        };
    }
    reset();

    // ----------------------------------------------------------- helpers ---

    function reply(ws, msg, msgId, data) {
        send(ws, withMsgId({ msg, data }, msgId));
    }

    function event(type, data) {
        const frame = { msg: 'admin_event', data: { type, ts: new Date().toISOString() } };
        if (data !== undefined) frame.data.data = data;
        broadcast(frame);
    }

    function newSession() {
        const token = randomBytes(32).toString('hex');
        state.sessions.set(token, Date.now() + SESSION_SECONDS * 1000);
        // The daemon keeps at most 32 sessions.
        while (state.sessions.size > 32) {
            state.sessions.delete(state.sessions.keys().next().value);
        }
        return token;
    }

    function sessionValid(token) {
        if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return false;
        const expiry = state.sessions.get(token);
        if (expiry === undefined) return false;
        if (expiry < Date.now()) {
            state.sessions.delete(token);
            return false;
        }
        return true;
    }

    function rateLimited() {
        const now = Date.now();
        state.failures = state.failures.filter((at) => now - at < RATE_LIMIT_WINDOW_MS);
        if (state.failures.length < RATE_LIMIT_FAILURES) return null;
        const retryAfter = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - state.failures[0])) / 1000);
        return failure('rate_limited', 'Too many attempts', { retry_after: String(retryAfter) });
    }

    /** The scenario errors every admin message shares; null when none applies. */
    function scenarioError() {
        switch (state.scenario) {
            case 'https_required':
                return failure('https_required', 'Admin requires https');
            case 'unavailable':
                return failure('admin_unavailable', 'calaos-container unreachable');
            case 'daemon_too_old':
                return failure('daemon_too_old', 'calaos-container does not know the admin routes');
            case 'daemon_unreachable':
                return failure('daemon_unreachable', 'calaos-container unreachable');
            default:
                return null;
        }
    }

    function isDefaultHousehold() {
        return hub.user === 'user' && hub.pass === 'pass';
    }

    // ------------------------------------------------------------ upgrade ---

    function startJob(kind, pkg) {
        const packages = pkg === undefined ? Object.keys(state.updates) : [pkg];
        state.job = {
            id: randomBytes(8).toString('hex'),
            kind,
            ...(pkg === undefined ? {} : { package: pkg }),
            status: 'running',
            reboot_required: false,
            daemon_restart: false,
            started_at: new Date().toISOString(),
        };
        state.progress = {
            ...idleProgress(),
            status: 'upgrading',
            pkg_count: packages.length,
            packages,
            current_pkg: packages[0] ?? '',
            pkg_index: packages.length > 0 ? 1 : 0,
            current_step: 'download',
        };
        state.dropped = false;
        event('upgrade_progress', state.progress);

        const stepMs = Math.max(50, Math.round(state.upgradeMs / 10));
        timer = setInterval(() => tick(packages), stepMs);
        return state.job;
    }

    function tick(packages) {
        const p = state.progress;
        p.total_percent = Math.min(100, p.total_percent + 10);
        if (packages.length > 0) {
            const index = Math.min(packages.length - 1, Math.floor((p.total_percent / 100) * packages.length));
            p.pkg_index = index + 1;
            p.current_pkg = packages[index];
            p.current_step = p.total_percent % 20 === 0 ? 'install' : 'download';
            p.current_percent = (p.total_percent * packages.length) % 100;
        }

        if (state.failAtPercent !== null && p.total_percent >= state.failAtPercent) {
            finishJob('error', 'apt-get returned 100');
            return;
        }

        if (p.total_percent >= 100) {
            finishJob('done', '');
            return;
        }

        event('upgrade_progress', p);

        // The restart of calaos-server by its own package: every client is
        // cut without a close frame, and the run carries on without them.
        if (state.dropAtPercent !== null && !state.dropped && p.total_percent >= state.dropAtPercent) {
            state.dropped = true;
            hub.dropClients();
        }
    }

    function finishJob(status, error) {
        if (timer !== null) clearInterval(timer);
        timer = null;
        const p = state.progress;
        p.status = status;
        p.error = error;
        p.message = status === 'done' ? 'upgrade finished' : error;
        if (status === 'done') {
            p.total_percent = 100;
            for (const name of p.packages) delete state.updates[name];
        }
        state.job = {
            ...state.job,
            status,
            ...(status === 'error' ? { error } : {}),
            reboot_required: status === 'done' && state.rebootRequired,
            finished_at: new Date().toISOString(),
        };
        event('upgrade_progress', p);
        // The legacy <Status> is idle whenever no run is in progress: after
        // the terminal event, only the job remembers how the run ended.
        state.progress = idleProgress();
    }

    function running() {
        return state.job !== null && state.job.status === 'running';
    }

    // ----------------------------------------------------------- messages ---

    function handleUnlock(ws, frame) {
        const msgId = frame.msg_id;
        const scenario = scenarioError();
        if (scenario !== null) return reply(ws, 'admin_unlock', msgId, scenario);
        const limited = rateLimited();
        if (limited !== null) return reply(ws, 'admin_unlock', msgId, limited);

        const data = frame.data ?? {};
        if (typeof data.admin_pass !== 'string') {
            return reply(ws, 'admin_unlock', msgId, failure('invalid_request', 'admin_pass missing'));
        }
        if (!state.set) {
            return reply(ws, 'admin_unlock', msgId, failure('admin_not_set', 'Admin password not set', {
                api_allowed_hosts: state.apiAllowedHosts,
            }));
        }
        if (data.admin_pass !== state.password) {
            state.failures.push(Date.now());
            return reply(ws, 'admin_unlock', msgId, failure('bad_password', 'Wrong admin password'));
        }
        state.failures = [];
        reply(ws, 'admin_unlock', msgId, {
            success: 'true',
            admin_session: newSession(),
            expires_in: String(SESSION_SECONDS),
        });
    }

    function handleSet(ws, frame) {
        const msgId = frame.msg_id;
        const scenario = scenarioError();
        if (scenario !== null) return reply(ws, 'admin_set', msgId, scenario);

        const data = frame.data ?? {};
        if (typeof data.new_pass !== 'string') {
            return reply(ws, 'admin_set', msgId, failure('invalid_request', 'new_pass missing'));
        }
        const hasSession = Object.prototype.hasOwnProperty.call(data, 'admin_session');
        let mode;
        if (hasSession) {
            if (!state.set) {
                return reply(ws, 'admin_set', msgId, failure('admin_not_set', 'Admin password not set', {
                    api_allowed_hosts: state.apiAllowedHosts,
                }));
            }
            if (!sessionValid(data.admin_session)) {
                return reply(ws, 'admin_set', msgId, failure('bad_session', 'Admin session required'));
            }
            mode = 'change';
        } else {
            if (state.set) {
                return reply(ws, 'admin_set', msgId, failure('admin_already_set', 'Admin password already set'));
            }
            if (isDefaultHousehold()) {
                return reply(ws, 'admin_set', msgId, failure(
                    'household_password_required',
                    'Change the household password first',
                ));
            }
            mode = 'bootstrap';
        }
        if ([...data.new_pass].length < MIN_PASSWORD_LENGTH) {
            return reply(ws, 'admin_set', msgId, failure('password_too_short', 'Password too short', {
                min_length: String(MIN_PASSWORD_LENGTH),
            }));
        }

        state.set = true;
        state.password = data.new_pass;
        state.sessions.clear();
        reply(ws, 'admin_set', msgId, { success: 'true', mode });
        // Through the daemon's /events and CB3, the alert lands a little
        // after the reply — typically after the client's follow-up unlock.
        setTimeout(() => event('admin_set'), 150);
    }

    function handleAdmin(ws, frame) {
        const msgId = frame.msg_id;
        const data = frame.data ?? {};
        const action = data.action;
        const respond = (payload) => reply(ws, 'admin', msgId, payload);
        const ok = (result) => respond({ success: 'true', result });

        const scenario = scenarioError();
        if (scenario !== null) return respond(scenario);
        if (!ACTIONS.includes(action)) return respond(failure('not_allowed', 'unknown action'));
        if (!state.set) {
            return respond(failure('admin_not_set', 'Admin password not set', {
                api_allowed_hosts: state.apiAllowedHosts,
            }));
        }
        if (action !== 'update_status' && !sessionValid(data.admin_session)) {
            return respond(failure('bad_session', 'Admin session required'));
        }

        switch (action) {
            case 'update_status':
                return ok({ progress: state.progress, job: state.job });
            case 'update_check':
            case 'update_available':
                if (running()) {
                    return respond(failure('upgrade_in_progress', 'upgrade already in progress', {
                        job_id: state.job.id,
                    }));
                }
                return ok(structuredClone(state.updates));
            case 'update_upgrade_all':
                if (running()) {
                    return respond(failure('upgrade_in_progress', 'upgrade already in progress', {
                        job_id: state.job.id,
                    }));
                }
                return ok(startJob('upgrade_all'));
            case 'update_upgrade': {
                const pkg = data.params?.package;
                if (typeof pkg !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(pkg) || pkg.includes('..') || pkg.length > 128) {
                    return respond(failure('invalid_request', 'invalid package name'));
                }
                if (running()) {
                    return respond(failure('upgrade_in_progress', 'upgrade already in progress', {
                        job_id: state.job.id,
                    }));
                }
                if (!(pkg in state.updates)) {
                    return respond(failure('package_not_found', `no pending update for ${pkg}`));
                }
                return ok(startJob('upgrade', pkg));
            }
            case 'system_reboot':
                if (running()) {
                    return respond(failure('upgrade_in_progress', 'upgrade already in progress', {
                        job_id: state.job.id,
                    }));
                }
                state.reboots += 1;
                return ok(null);
            case 'system_restart':
                state.restarts += 1;
                return ok(null);
            case 'system_info':
                return ok({ hostname: 'calaos-mock', uptime: 4242, cpu_usage: 3.5, mem_usage: 41.2 });
            case 'mcp_regenerate':
                state.mcpRegenerations += 1;
                return ok({});
        }
    }

    /** `settings` / `change_cred`: the household password. */
    function handleSettings(ws, frame) {
        const data = frame.data ?? {};
        // Any other action gets no reply at all, like upstream.
        if (data.action !== 'change_cred') return;
        const ok =
            data.old_user === hub.user &&
            data.old_pw === hub.pass &&
            typeof data.new_user === 'string' &&
            data.new_user !== '' &&
            typeof data.new_pw === 'string' &&
            data.new_pw !== '';
        if (ok) {
            hub.user = data.new_user;
            hub.pass = data.new_pw;
            // Upstream drops `loggedin`: the client must log in again.
            ws.authed = false;
        }
        send(ws, { msg: 'settings', data: { action: 'change_cred', success: ok ? 'true' : 'false' } });
    }

    /**
     * Dispatches an admin frame. Returns false for frames that are not the
     * admin's business. `old_server` swallows every admin message, as an old
     * calaos_server does with WS messages it does not know.
     */
    function handleFrame(ws, frame) {
        switch (frame.msg) {
            case 'admin_unlock':
            case 'admin_set':
            case 'admin':
                if (!ws.authed) return true;
                if (state.scenario === 'old_server') return true;
                if (frame.msg === 'admin_unlock') handleUnlock(ws, frame);
                else if (frame.msg === 'admin_set') handleSet(ws, frame);
                else handleAdmin(ws, frame);
                return true;
            case 'settings':
                if (!ws.authed) return true;
                handleSettings(ws, frame);
                return true;
            default:
                return false;
        }
    }

    // ------------------------------------------------------------ control ---

    /** `/control {op:'admin', ...}`: patches the fake daemon. */
    function configure(patch) {
        if (patch.scenario !== undefined) {
            if (patch.scenario !== null && !ADMIN_SCENARIOS.includes(patch.scenario)) {
                return { ok: false, error: `unknown admin scenario '${patch.scenario}'`, known: ADMIN_SCENARIOS };
            }
            state.scenario = patch.scenario;
        }
        if (patch.set !== undefined) {
            state.set = Boolean(patch.set);
            if (!state.set) {
                state.password = '';
                state.sessions.clear();
            }
        }
        if (typeof patch.password === 'string') {
            state.password = patch.password;
            state.set = true;
        }
        if (typeof patch.apiAllowedHosts === 'string') state.apiAllowedHosts = patch.apiAllowedHosts;
        if (patch.updates !== undefined) {
            state.updates = {};
            const entries = Array.isArray(patch.updates)
                ? patch.updates.map((name) => [name, { name, version: '2.0.0', current_version: '1.0.0' }])
                : Object.entries(patch.updates);
            for (const [name, entry] of entries) state.updates[name] = { name, ...entry };
        }
        if (patch.upgradeMs !== undefined) state.upgradeMs = Number(patch.upgradeMs);
        if (patch.dropAtPercent !== undefined) state.dropAtPercent = patch.dropAtPercent;
        if (patch.failAtPercent !== undefined) state.failAtPercent = patch.failAtPercent;
        if (patch.rebootRequired !== undefined) state.rebootRequired = Boolean(patch.rebootRequired);
        if (patch.clearSessions) state.sessions.clear();
        return { ok: true, ...status() };
    }

    function status() {
        return {
            set: state.set,
            apiAllowedHosts: state.apiAllowedHosts,
            scenario: state.scenario,
            sessions: state.sessions.size,
            updates: Object.keys(state.updates),
            progress: state.progress,
            job: state.job,
            reboots: state.reboots,
            restarts: state.restarts,
            mcpRegenerations: state.mcpRegenerations,
            upgradeMs: state.upgradeMs,
            dropAtPercent: state.dropAtPercent,
            failAtPercent: state.failAtPercent,
            rebootRequired: state.rebootRequired,
        };
    }

    return { reset, handleFrame, configure, status, event };
}
