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
//
// Approvers and push codes follow calaos-container docs/API.md ("Approvers",
// "Push codes"): a code "pushed" to a phone is recorded in `pushed`, which
// is how a test reads what the phone received. The approver alerts land in
// the event log (`eventlog`) the way calaos_server stores them.

import { randomBytes, randomUUID } from 'node:crypto';
import { createConfig } from './admin-config.mjs';
import { createLogs } from './admin-logs.mjs';
import { createNetwork, networkBinding } from './admin-network.mjs';
import { createServices } from './admin-services.mjs';
import { createTime } from './admin-time.mjs';

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
    'approver_list',
    'approver_candidates',
    'approver_enroll',
    'approver_confirm',
    'approver_remove',
    'code_request',
    'code_verify',
    'console_open',
    'services_list',
    'services_restart',
    'logs_sources',
    'logs_query',
    'time_get',
    'time_zones',
    'time_set',
    'network_state',
    'network_apply',
    'network_confirm',
    'network_revert',
    'config_list',
    'config_set',
    'config_backup',
];

const CODE_ACTIONS = ['console_open', 'admin_password', 'approver_enroll', 'approver_remove', 'network_config'];
/** The phase-3 features, each in its own module; `/control {op:'admin', <name>: {...}}` patches one. */
const FEATURES = ['services', 'logs', 'time', 'config', 'network'];
const APPROVER_MAX = 2;
const CODE_FAILURES_MAX = 5;
const HEX16 = /^[0-9a-f]{16}$/;
const SIX_DIGITS = /^[0-9]{6}$/;
/** calaos_server's `CalaosEvent::EventPushNotification`. */
const PUSH_NOTIFICATION_EVENT = '22';
const ALERT_PREFIXES = {
    approver_set: 'New approver phone on your Calaos box: ',
    approver_removed: 'Approver phone removed from your Calaos box: ',
};

const SESSION_SECONDS = 900;
/** A verified `console_open` code opens one console within this delay. */
const CONSOLE_GRANT_MS = 30_000;
const MIN_PASSWORD_LENGTH = 10;
/** Daemon limiter: about 5 failures per minute. */
const RATE_LIMIT_FAILURES = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;
/** Between the terminal `upgrade_progress` frame and the end of the job. */
const SETTLE_MS = 50;

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

// What calaos_server lets a household client see of <Status> and <Job>
// (CB3's AdminEvents): allow lists of scalars, so a field the daemon adds
// later is not leaked.
const HOUSEHOLD_STATUS_FIELDS = [
    'status',
    'total_percent',
    'current_step',
    'current_percent',
    'pkg_index',
    'pkg_count',
    'progress',
    'progress_total',
];
const HOUSEHOLD_JOB_FIELDS = ['id', 'kind', 'status', 'reboot_required', 'daemon_restart', 'started_at', 'finished_at'];

function copyScalars(from, keys) {
    const out = {};
    for (const key of keys) {
        const value = from[key];
        if (value !== null && ['string', 'number', 'boolean'].includes(typeof value)) out[key] = value;
    }
    return out;
}

export function householdStatus(status) {
    const out = copyScalars(status, HOUSEHOLD_STATUS_FIELDS);
    if (Array.isArray(status.packages)) {
        out.packages = status.packages.map((entry) =>
            typeof entry === 'object' && entry !== null ? copyScalars(entry, ['state', 'percent']) : {},
        );
    }
    if (typeof status.error === 'string' && status.error !== '') out.error = 'upgrade failed';
    return out;
}

export function householdJob(job) {
    if (job === null) return null;
    const out = copyScalars(job, HOUSEHOLD_JOB_FIELDS);
    if (typeof job.error === 'string' && job.error !== '') {
        out.error = job.error === 'interrupted' ? 'interrupted' : 'upgrade failed';
    }
    return out;
}

function failure(error, msg, extra = {}) {
    return { success: 'false', error, msg, ...extra };
}

function hex16() {
    return randomBytes(8).toString('hex');
}

/** SQLite's CURRENT_TIMESTAMP: UTC, second precision, a space for the T. */
function sqliteTime(ms) {
    return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function iso(ms) {
    return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Two iPhones of the same name (iOS 16+) and an Android phone. */
function defaultPushTokens(now) {
    const day = 86_400_000;
    return [
        { token_id: '0c1d2e3f4a5b6c7d', device_name: 'Pixel 8', platform: 'android', registered_at: iso(now - 90 * day), last_seen: iso(now - 10 * 60_000), secure: true },
        { token_id: 'a1b2c3d4e5f60718', device_name: 'iPhone', platform: 'ios', registered_at: iso(now - 200 * day), last_seen: iso(now - 2 * 3_600_000), secure: false },
        { token_id: '9f8e7d6c5b4a3921', device_name: 'iPhone', platform: 'ios', registered_at: iso(now - 30 * day), last_seen: iso(now - 3 * day), secure: false },
    ];
}

export function createAdmin({ hub, send, broadcast, withMsgId }) {
    let state;
    let timer = null;
    /** Built once the helpers they share exist; see below. */
    let features;

    function reset() {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        if (features !== undefined) for (const name of FEATURES) features[name].reset();
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
            pushTokens: defaultPushTokens(Date.now()),
            /** <Approver>, oldest first. */
            approvers: [],
            /** code_id → {session, action, params, code, approverId, expiresAt, enrol}. */
            codes: new Map(),
            /** session → {failures, lastCodeAt, pending}. */
            codeSessions: new Map(),
            codeTtlMs: 60_000,
            codeIntervalMs: 10_000,
            /** Every code a phone received, in order. */
            pushed: [],
            /** code_id → {session, expiresAt}: verified console codes not yet used. */
            consoleGrants: new Map(),
            /** The event log's persistent events, oldest first. */
            events: [],
            eventlogReads: 0,
        };
    }
    reset();

    // ----------------------------------------------------------- helpers ---

    function reply(ws, msg, msgId, data) {
        send(ws, withMsgId({ msg, data }, msgId));
    }

    function event(type, data) {
        const frame = { msg: 'admin_event', data: { type, ts: new Date().toISOString() } };
        if (data !== undefined) frame.data.data = type === 'upgrade_progress' ? householdStatus(data) : data;
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

    function wellFormedSession(token) {
        return typeof token === 'string' && /^[0-9a-f]{64}$/.test(token);
    }

    function sessionValid(token) {
        if (!wellFormedSession(token)) return false;
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
            packages: packages.map((name) => ({ name, state: 'pending', percent: 0 })),
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
            p.packages.forEach((entry, i) => {
                entry.state = i < index ? 'done' : i === index ? p.current_step : 'pending';
                entry.percent = i < index ? 100 : i === index ? p.current_percent : 0;
            });
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
            for (const entry of p.packages) delete state.updates[entry.name];
        }
        // The daemon's order: the terminal frame while the job still runs
        // (snapshot, version refresh), then `idle`, then the job ends. The
        // legacy <Status> is idle whenever no run is in progress: from then
        // on, only the job remembers how the run ended.
        event('upgrade_progress', p);
        timer = setTimeout(() => {
            timer = null;
            state.progress = idleProgress();
            event('upgrade_progress', state.progress);
            state.job = {
                ...state.job,
                status,
                ...(status === 'error' ? { error } : {}),
                reboot_required: status === 'done' && state.rebootRequired,
                finished_at: new Date().toISOString(),
            };
        }, SETTLE_MS);
    }

    function running() {
        return state.job !== null && state.job.status === 'running';
    }

    // ---------------------------------------------------------- approvers ---

    function tokenEntry(tokenId) {
        return state.pushTokens.find((entry) => entry.token_id === tokenId);
    }

    function approverList() {
        return state.approvers.map((approver) => {
            const entry = tokenEntry(approver.token_id);
            return {
                ...approver,
                platform: entry?.platform ?? '',
                registered_at: entry?.registered_at ?? '',
                last_seen: entry?.last_seen ?? '',
                secure: entry?.secure === true,
            };
        });
    }

    function candidates() {
        return [...state.pushTokens]
            .sort((a, b) => b.last_seen.localeCompare(a.last_seen))
            .map((entry) => ({
                ...entry,
                approver: state.approvers.some((approver) => approver.token_id === entry.token_id),
            }));
    }

    function codeSession(session) {
        let meta = state.codeSessions.get(session);
        if (meta === undefined) {
            meta = { failures: 0, lastCodeAt: -Infinity, pending: null };
            state.codeSessions.set(session, meta);
        }
        return meta;
    }

    /** calaos_server's own checks: both fields or neither, well formed. */
    function proofFormatError(fields, required) {
        const hasId = fields.code_id !== undefined;
        const hasCode = fields.code !== undefined;
        if (!required && !hasId && !hasCode) return null;
        if (hasId !== hasCode || !HEX16.test(String(fields.code_id)) || !SIX_DIGITS.test(String(fields.code))) {
            return failure('invalid_request', 'code_id and code must go together, well formed');
        }
        return null;
    }

    function rateLimit(session) {
        const elapsed = Date.now() - codeSession(session).lastCodeAt;
        if (elapsed >= state.codeIntervalMs) return null;
        const retryAfter = Math.ceil((state.codeIntervalMs - elapsed) / 1000);
        return failure('rate_limited', 'Too many codes', { retry_after: String(retryAfter) });
    }

    /** One pending code per session: a new one replaces it. Then the push. */
    function issueCode(session, action, params, approverId, tokenId, enrol) {
        const meta = codeSession(session);
        const now = Date.now();
        if (meta.pending !== null) state.codes.delete(meta.pending);
        const codeId = hex16();
        const code = String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, '0');
        state.codes.set(codeId, {
            session,
            action,
            params: JSON.stringify(params),
            code,
            approverId,
            expiresAt: now + state.codeTtlMs,
            enrol,
        });
        meta.pending = codeId;
        meta.lastCodeAt = now;
        // calaos_server pushes only to a token it still knows (purged after 30 days).
        if (tokenEntry(tokenId) !== undefined) {
            state.pushed.push({ code_id: codeId, code, action, approver_id: approverId, token_id: tokenId });
        }
        return { codeId, expiresIn: Math.round(state.codeTtlMs / 1000) };
    }

    /** Checks and spends a code; null when it is good. 5 wrong codes end the session. */
    function useCode(session, fields, action, params) {
        const entry = state.codes.get(fields.code_id);
        if (entry === undefined || entry.session !== session || entry.expiresAt < Date.now()) {
            return failure('code_expired', 'Code expired or unknown');
        }
        if (entry.action !== action || entry.params !== JSON.stringify(params) || entry.code !== fields.code) {
            const meta = codeSession(session);
            meta.failures += 1;
            const left = Math.max(0, CODE_FAILURES_MAX - meta.failures);
            if (left === 0) {
                state.sessions.delete(session);
                for (const [id, code] of state.codes) if (code.session === session) state.codes.delete(id);
            }
            return failure('bad_code', 'Wrong code', { attempts_left: String(left) });
        }
        state.codes.delete(fields.code_id);
        codeSession(session).pending = null;
        return null;
    }

    function codeRequest(session, params) {
        const action = params.code_action;
        if (!CODE_ACTIONS.includes(action)) return failure('invalid_request', 'unknown code action');
        const raw = typeof params.code_params === 'object' && params.code_params !== null ? params.code_params : {};
        let bound = {};
        if (action === 'admin_password') {
            if (typeof raw.password !== 'string' || raw.password === '') return failure('invalid_request', 'password missing');
            bound = { password: raw.password };
        } else if (action === 'approver_remove') {
            if (!HEX16.test(String(raw.approver_id))) return failure('invalid_request', 'approver_id missing');
            bound = { approver_id: raw.approver_id };
        } else if (action === 'network_config') {
            const checked = networkBinding(raw, failure);
            if (checked.error !== undefined) return checked.error;
            bound = checked.bound;
        }
        if (params.approver_id !== undefined && !HEX16.test(String(params.approver_id))) {
            return failure('invalid_request', 'invalid approver_id');
        }
        if (state.approvers.length === 0) return failure('approver_required', 'No approver phone enrolled');
        const target = params.approver_id === undefined
            ? state.approvers[0]
            : state.approvers.find((approver) => approver.id === params.approver_id);
        if (target === undefined) return failure('approver_not_found', 'Unknown approver');
        if (action === 'admin_password' && [...bound.password].length < MIN_PASSWORD_LENGTH) {
            return failure('password_too_short', 'Password too short', { min_length: String(MIN_PASSWORD_LENGTH) });
        }
        if (action === 'approver_enroll' && state.approvers.length >= APPROVER_MAX) {
            return failure('approver_limit', 'Two approvers at most', { max: String(APPROVER_MAX) });
        }
        if (action === 'approver_remove') {
            if (!state.approvers.some((approver) => approver.id === bound.approver_id)) {
                return failure('approver_not_found', 'Unknown approver');
            }
            if (state.approvers.length === 1) return failure('approver_last', 'The last approver cannot be removed');
        }
        const limited = rateLimit(session);
        if (limited !== null) return limited;
        const issued = issueCode(session, action, bound, target.id, target.token_id, null);
        return {
            success: 'true',
            result: { code_id: issued.codeId, approver_id: target.id, expires_in: issued.expiresIn },
        };
    }

    function approverEnroll(session, params) {
        if (!HEX16.test(String(params.token_id))) return failure('invalid_request', 'invalid token_id');
        const formatError = proofFormatError(params, false);
        if (formatError !== null) return formatError;
        const entry = tokenEntry(params.token_id);
        if (entry === undefined) return failure('invalid_request', 'Unknown token_id');
        if (state.approvers.length >= APPROVER_MAX) {
            return failure('approver_limit', 'Two approvers at most', { max: String(APPROVER_MAX) });
        }
        if (state.approvers.some((approver) => approver.token_id === entry.token_id)) {
            return failure('approver_exists', 'Already an approver');
        }
        const approved = params.code_id !== undefined;
        // An approval code already paid the interval.
        if (!approved) {
            const limited = rateLimit(session);
            if (limited !== null) return limited;
        }
        if (state.approvers.length > 0) {
            if (!approved) return failure('code_required', 'An approval code is required');
            const codeError = useCode(session, params, 'approver_enroll', {});
            if (codeError !== null) return codeError;
        }
        const approverId = hex16();
        const enrol = {
            approverId,
            tokenId: entry.token_id,
            deviceName: entry.device_name,
            withApprover: state.approvers.length > 0,
        };
        const issued = issueCode(session, 'enroll', {}, approverId, entry.token_id, enrol);
        return {
            success: 'true',
            result: { approver_id: approverId, code_id: issued.codeId, expires_in: issued.expiresIn },
        };
    }

    function approverConfirm(session, params) {
        const formatError = proofFormatError(params, true);
        if (formatError !== null) return formatError;
        const enrol = state.codes.get(params.code_id)?.enrol ?? null;
        const codeError = useCode(session, params, 'enroll', {});
        if (codeError !== null) return codeError;
        if (state.approvers.length >= APPROVER_MAX) {
            return failure('approver_limit', 'Two approvers at most', { max: String(APPROVER_MAX) });
        }
        if (state.approvers.some((approver) => approver.token_id === enrol.tokenId)) {
            return failure('approver_exists', 'Already an approver');
        }
        if (!enrol.withApprover && state.approvers.length > 0) {
            return failure('code_required', 'An approver was enrolled meanwhile');
        }
        const approver = {
            id: enrol.approverId,
            device_name: enrol.deviceName,
            token_id: enrol.tokenId,
            created_at: iso(Date.now()),
        };
        state.approvers.push(approver);
        raiseAlert('approver_set', approver.device_name);
        return { success: 'true', result: approver };
    }

    function approverRemove(session, params) {
        if (!HEX16.test(String(params.approver_id))) return failure('invalid_request', 'invalid approver_id');
        const formatError = proofFormatError(params, true);
        if (formatError !== null) return formatError;
        const index = state.approvers.findIndex((approver) => approver.id === params.approver_id);
        if (index < 0) return failure('approver_not_found', 'Unknown approver');
        if (state.approvers.length === 1) return failure('approver_last', 'The last approver cannot be removed');
        const codeError = useCode(session, params, 'approver_remove', { approver_id: params.approver_id });
        if (codeError !== null) return codeError;
        const [removed] = state.approvers.splice(index, 1);
        for (const [id, code] of state.codes) if (code.approverId === removed.id) state.codes.delete(id);
        raiseAlert('approver_removed', removed.device_name);
        return { success: 'true', result: { approver_id: removed.id } };
    }

    /** What calaos_server does with a daemon alert: a persistent event, then `admin_event`. */
    function raiseAlert(type, deviceName, at = Date.now()) {
        const name = String(deviceName).replace(/["«»“”„‟″‶＂]/g, "'") || '?';
        state.events.push({
            id: randomUUID(),
            event_type: PUSH_NOTIFICATION_EVENT,
            io_id: '',
            io_state: '',
            pic_uid: '',
            created_at: sqliteTime(at),
            event_raw: { message: `${ALERT_PREFIXES[type]}"${name}"`, pic_uid: '' },
        });
        event(type);
    }

    /** IO history rows, as the log holds for every IO with `log_history`. */
    function addNoise(count) {
        for (let i = 0; i < count; i += 1) {
            state.events.push({
                id: randomUUID(),
                event_type: '3',
                io_id: 'light_1',
                io_state: i % 2 === 0 ? 'true' : 'false',
                pic_uid: '',
                created_at: sqliteTime(Date.now()),
                event_raw: { type: '3', type_str: 'io_changed', data: { id: 'light_1', state: i % 2 === 0 ? 'true' : 'false' } },
            });
        }
    }

    function handleEventLog(ws, frame) {
        state.eventlogReads += 1;
        const data = frame.data ?? {};
        const perPage = data.per_page === undefined || data.per_page === '' ? 100 : Number(data.per_page);
        const page = data.page === undefined || data.page === '' ? 0 : Number(data.page);
        if (!Number.isInteger(perPage) || perPage <= 0) {
            return reply(ws, 'eventlog', frame.msg_id, { error: 'per_page is out of range' });
        }
        const newest = [...state.events].reverse();
        reply(ws, 'eventlog', frame.msg_id, {
            total_page: Math.ceil(newest.length / perPage),
            total_count: newest.length,
            page,
            per_page: perPage,
            events: newest.slice(page * perPage, (page + 1) * perPage),
        });
    }

    // ----------------------------------------------------------- features ---

    features = {
        services: createServices({ hub, failure, running }),
        logs: createLogs({ failure }),
        time: createTime({ failure }),
        config: createConfig({ failure, hub }),
        network: createNetwork({ hub, failure, event, running, useCode, proofFormatError }),
    };

    /** `config_backup` over HTTP: the same guards as the WS action, then a download. */
    function httpConfigBackup(body) {
        const scenario = scenarioError();
        let refusal = null;
        if (scenario !== null) refusal = scenario;
        else if (!state.set) refusal = failure('admin_not_set', 'Admin password not set', { api_allowed_hosts: state.apiAllowedHosts });
        else if (!sessionValid(body.admin_session)) refusal = failure('bad_session', 'Admin session required');
        return features.config.httpBackup(refusal);
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
            const formatError = proofFormatError(data, false);
            if (formatError !== null) return reply(ws, 'admin_set', msgId, formatError);
            if (state.approvers.length === 0) {
                return reply(ws, 'admin_set', msgId, failure('approver_required', 'No approver phone enrolled'));
            }
            if (data.code_id === undefined) {
                return reply(ws, 'admin_set', msgId, failure('code_required', 'A push code is required'));
            }
            if ([...data.new_pass].length < MIN_PASSWORD_LENGTH) {
                return reply(ws, 'admin_set', msgId, failure('password_too_short', 'Password too short', {
                    min_length: String(MIN_PASSWORD_LENGTH),
                }));
            }
            const codeError = useCode(data.admin_session, data, 'admin_password', { password: data.new_pass });
            if (codeError !== null) return reply(ws, 'admin_set', msgId, codeError);
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
        if (action === 'update_status') {
            // No well-formed session: calaos_server answers the household
            // view itself; a well-formed one goes to the daemon, which may refuse it.
            if (!wellFormedSession(data.admin_session)) {
                return ok({ progress: householdStatus(state.progress), job: householdJob(state.job) });
            }
            if (!sessionValid(data.admin_session)) {
                return respond(failure('bad_session', 'Admin session required'));
            }
            return ok({ progress: state.progress, job: state.job });
        }
        if (!sessionValid(data.admin_session)) {
            return respond(failure('bad_session', 'Admin session required'));
        }
        const params = typeof data.params === 'object' && data.params !== null ? data.params : {};

        for (const name of FEATURES) {
            // undefined: not this feature's action; null: the socket is gone, no answer.
            const payload = features[name].handle(action, data.admin_session, params);
            if (payload === null) return;
            if (payload !== undefined) return respond(payload);
        }

        switch (action) {
            case 'approver_list':
                return ok(approverList());
            case 'approver_candidates':
                return ok(candidates());
            case 'code_request':
                return respond(codeRequest(data.admin_session, params));
            case 'code_verify':
            case 'console_open': {
                const formatError = proofFormatError(params, true);
                if (formatError !== null) return respond(formatError);
                const entry = state.codes.get(params.code_id);
                if (entry !== undefined && entry.action !== 'console_open') {
                    return respond(failure('invalid_request', 'not a console code'));
                }
                const codeError = useCode(data.admin_session, params, 'console_open', {});
                if (codeError !== null) return respond(codeError);
                state.consoleGrants.set(params.code_id, {
                    session: data.admin_session,
                    expiresAt: Date.now() + CONSOLE_GRANT_MS,
                });
                return ok({ action: 'console_open', expires_in: CONSOLE_GRANT_MS / 1000 });
            }
            case 'approver_enroll':
                return respond(approverEnroll(data.admin_session, params));
            case 'approver_confirm':
                return respond(approverConfirm(data.admin_session, params));
            case 'approver_remove':
                return respond(approverRemove(data.admin_session, params));
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
            case 'eventlog':
                if (!ws.authed) return true;
                handleEventLog(ws, frame);
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
        if (Array.isArray(patch.pushTokens)) state.pushTokens = structuredClone(patch.pushTokens);
        if (Array.isArray(patch.approvers)) {
            // A push token's token_id, or {token_id, device_name} for a phone
            // whose token is gone; oldest first; seeded state, so no alert.
            state.approvers = patch.approvers.map((entry, i) => {
                const tokenId = typeof entry === 'string' ? entry : entry.token_id;
                return {
                    id: hex16(),
                    device_name: entry.device_name ?? tokenEntry(tokenId)?.device_name ?? 'Phone',
                    token_id: tokenId,
                    created_at: iso(Date.now() - (patch.approvers.length - i) * 86_400_000),
                };
            });
        }
        for (const name of FEATURES) {
            if (typeof patch[name] !== 'object' || patch[name] === null) continue;
            const problem = features[name].configure(patch[name]);
            if (problem !== null) return { ok: false, error: problem };
        }
        if (Number.isInteger(patch.noiseEvents)) addNoise(patch.noiseEvents);
        if (patch.codeTtlMs !== undefined) state.codeTtlMs = Number(patch.codeTtlMs);
        if (patch.codeIntervalMs !== undefined) state.codeIntervalMs = Number(patch.codeIntervalMs);
        if (patch.expireCodes) for (const code of state.codes.values()) code.expiresAt = 0;
        if (Array.isArray(patch.alerts)) {
            for (const alert of patch.alerts) {
                if (!(alert.type in ALERT_PREFIXES)) return { ok: false, error: `unknown alert type '${alert.type}'` };
                raiseAlert(alert.type, alert.device_name, alert.at === undefined ? Date.now() : Date.parse(alert.at));
            }
        }
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
            approvers: approverList(),
            pushed: state.pushed,
            events: state.events.length,
            eventlogReads: state.eventlogReads,
            ...Object.fromEntries(FEATURES.map((name) => [name, features[name].status()])),
        };
    }

    /**
     * What `POST admin/console` decides for /api/console: null when a console
     * may open, else the error the tunnel sends back. A grant serves once.
     */
    function takeConsoleGrant(session, codeId) {
        const scenario = scenarioError();
        if (scenario !== null && scenario.error !== 'https_required') return scenario;
        if (!state.set) return failure('admin_not_set', 'No admin password', { api_allowed_hosts: state.apiAllowedHosts });
        if (!sessionValid(session)) return failure('bad_session', 'Admin session required');
        const grant = state.consoleGrants.get(codeId);
        state.consoleGrants.delete(codeId);
        if (grant === undefined || grant.session !== session || grant.expiresAt < Date.now()) {
            return failure('code_expired', 'The push code expired, request a new one');
        }
        return null;
    }

    return { reset, handleFrame, configure, status, event, takeConsoleGrant, httpConfigBackup };
}
