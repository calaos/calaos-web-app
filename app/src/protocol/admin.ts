// Admin protocol — the `admin_unlock` / `admin_set` / `admin` messages, the
// `admin_event` push and the error payload they all share. NO Vue imports.
//
// Contract: calaos_base docs/08_http_api.md, section "Administration". The
// client branches on the error CODE, never on `msg`. Every optional field of
// an error is a string on the wire; the `result` of an `admin` reply is the
// daemon's own JSON (real numbers and booleans), copied verbatim.

import { isRecord, toWireString } from './guards';

/** Replies to admin messages are expected within this delay… */
export const ADMIN_REPLY_TIMEOUT_MS = 5_000;
/** …except `update_check`, which runs a synchronous `apt-get update`… */
export const UPDATE_CHECK_TIMEOUT_MS = 125_000;
/** …and the actions calaos_server itself gives longer than 4 s (its delay plus margin). */
export const SYSTEM_RESTART_TIMEOUT_MS = 35_000;
export const LOGS_QUERY_TIMEOUT_MS = 12_000;
export const TIME_SET_TIMEOUT_MS = 40_000;
/** The upload of up to 4 MiB, then the validation and the copy of the current files. */
export const CONFIG_RESTORE_TIMEOUT_MS = 35_000;
/** `networkctl` can take up to 30 s; calaos_server waits 35 s. */
export const NETWORK_CHANGE_TIMEOUT_MS = 40_000;
/** `admin_unavailable`: retry every 5 s for 2 min, then every 60 s. */
export const UNAVAILABLE_FAST_RETRY_MS = 5_000;
export const UNAVAILABLE_FAST_WINDOW_MS = 120_000;
export const UNAVAILABLE_SLOW_RETRY_MS = 60_000;
/** `daemon_too_old` that lasts longer than this means the box needs a reboot. */
export const ACTIVATION_REBOOT_HINT_MS = 120_000;
/** Minimum admin password length enforced by the daemon (Unicode code points). */
export const ADMIN_PASSWORD_MIN_LENGTH = 10;
/** Push codes: 6 digits, valid 60 s, at least 10 s between two codes of a session. */
export const CODE_LENGTH = 6;
export const CODE_LIFETIME_S = 60;
export const CODE_RESEND_S = 10;
/** The daemon keeps at most this many approvers. */
export const APPROVER_MAX = 2;

export const ADMIN_ERROR_CODES = [
    'admin_not_set',
    'admin_already_set',
    'bad_password',
    'rate_limited',
    'household_password_required',
    'bad_session',
    'password_too_short',
    'https_required',
    'daemon_too_old',
    'daemon_unreachable',
    'admin_unavailable',
    'upgrade_in_progress',
    'not_allowed',
    'invalid_request',
    'package_not_found',
    'package_held',
    'approver_required',
    'approver_limit',
    'approver_exists',
    'approver_not_found',
    'approver_last',
    'code_required',
    'bad_code',
    'code_expired',
    'console_limit',
    'network_pending',
    'login_failed',
    'internal',
] as const;

export type AdminErrorCode = (typeof ADMIN_ERROR_CODES)[number];

/**
 * Codes the client itself produces. `timeout`: no reply within the delay — an
 * old calaos_server ignores unknown WS messages in silence. `disconnected`:
 * the socket dropped while the reply was pending. `household_refused`: the
 * server said no to `change_cred`. `busy`: another admin request holds the
 * page, nothing was sent. `unknown`: a code outside the contract (a newer
 * server), rendered as a generic failure.
 */
export type AdminFailureCode =
    | AdminErrorCode
    | 'timeout'
    | 'disconnected'
    | 'household_refused'
    | 'busy'
    | 'unknown';

export interface AdminError {
    code: AdminFailureCode;
    /** The server's English sentence; a display fallback, never branched on. */
    msg: string;
    /** Seconds, with `rate_limited`. */
    retryAfter: number | null;
    /** With `upgrade_in_progress`. */
    jobId: string;
    /** With `password_too_short`. */
    minLength: number | null;
    /** With `admin_not_set`: the raw `api_allowed_hosts` option, '' if unset. */
    apiAllowedHosts: string;
    /** With `bad_code`; 0 means the session is now invalidated. */
    attemptsLeft: number | null;
    /** With `approver_limit` and `console_limit`. */
    max: number | null;
    /** With `network_pending`: the change already waiting, and its seconds left. */
    changeId: string;
    expiresIn: number | null;
    /** With the `internal` of a partly applied `time_set`: the steps done, the one that failed. */
    applied: string[];
    failed: string;
    /** Same case: true once the timezone changed, whatever failed after it. */
    restartRequired: boolean;
    /**
     * `"outcome": "unknown"`: calaos_server gave up waiting for the daemon,
     * which may still have acted. Never resend; read the state again.
     */
    outcomeUnknown: boolean;
}

export const ADMIN_ACTIONS = [
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
    'config_restore',
] as const;

export type AdminAction = (typeof ADMIN_ACTIONS)[number];

/** The daemon's `<Status>` — the legacy upgrade progress object, unchanged. */
export interface UpgradeStatus {
    status: 'idle' | 'upgrading' | 'done' | 'error' | 'unknown';
    /** 0-100. */
    totalPercent: number;
    currentPkg: string;
    currentStep: string;
    pkgIndex: number;
    pkgCount: number;
    message: string;
    error: string;
    /** `packages[].name` by position (index 1 is `[0]`); empty in the household view. */
    packageNames: string[];
}

/** The daemon's `<Job>`. */
export interface UpgradeJob {
    id: string;
    kind: string;
    package: string;
    status: 'running' | 'done' | 'error' | 'unknown';
    error: string;
    rebootRequired: boolean;
    daemonRestart: boolean;
    startedAt: string;
    finishedAt: string;
}

/** What a push code protects (`code_request`'s `code_action`). */
export type CodeAction =
    | 'admin_password'
    | 'approver_enroll'
    | 'approver_remove'
    | 'console_open'
    | 'network_config';

/** An enrolled phone, from `approver_list`. Dates are RFC 3339, '' when unknown. */
export interface Approver {
    id: string;
    deviceName: string;
    tokenId: string;
    createdAt: string;
    platform: string;
    registeredAt: string;
    /** '' once the token left `push_tokens` (30 days without the app): no codes reach it. */
    lastSeen: string;
    /** The phone sent a push key: its codes travel encrypted and show in the app. */
    secure: boolean;
}

/** A phone that registered for push, from `approver_candidates`. */
export interface ApproverCandidate {
    tokenId: string;
    deviceName: string;
    platform: string;
    registeredAt: string;
    lastSeen: string;
    approver: boolean;
    secure: boolean;
}

/** A code on its way to a phone. */
export interface CodeTicket {
    codeId: string;
    /** The phone it was sent to. */
    approverId: string;
    expiresIn: number;
}

/** The `code_id` / `code` pair a protected action carries. */
export interface CodeProof {
    codeId: string;
    code: string;
}

export interface UpdateEntry {
    name: string;
    version: string;
    currentVersion: string;
}

/** The reply delay of one `admin` action, a little over calaos_server's own. */
export function adminReplyTimeoutMs(action: AdminAction): number {
    switch (action) {
        case 'update_check':
            return UPDATE_CHECK_TIMEOUT_MS;
        case 'system_restart':
            return SYSTEM_RESTART_TIMEOUT_MS;
        case 'logs_query':
            return LOGS_QUERY_TIMEOUT_MS;
        case 'time_set':
            return TIME_SET_TIMEOUT_MS;
        case 'config_restore':
            return CONFIG_RESTORE_TIMEOUT_MS;
        case 'network_apply':
        case 'network_confirm':
        case 'network_revert':
            return NETWORK_CHANGE_TIMEOUT_MS;
        default:
            return ADMIN_REPLY_TIMEOUT_MS;
    }
}

// ---------------------------------------------------------------- encoders ---

export function encodeAdminUnlock(adminPass: string, msgId: string): string {
    return JSON.stringify({ msg: 'admin_unlock', msg_id: msgId, data: { admin_pass: adminPass } });
}

/**
 * Without a session the server reads this as a bootstrap; with one, as a
 * change. The key is omitted rather than sent empty: an empty `admin_session`
 * counts as PRESENT and gets `bad_session`.
 */
export function encodeAdminSet(
    newPass: string,
    session: string | null,
    msgId: string,
    proof?: CodeProof,
): string {
    const data: Record<string, string> =
        session === null ? { new_pass: newPass } : { new_pass: newPass, admin_session: session };
    if (session !== null && proof !== undefined) {
        data.code_id = proof.codeId;
        data.code = proof.code;
    }
    return JSON.stringify({ msg: 'admin_set', msg_id: msgId, data });
}

/** `admin_session` is required by every action except `update_status`. */
export function encodeAdminAction(
    action: AdminAction,
    session: string | null,
    msgId: string,
    params?: Record<string, unknown>,
): string {
    const data: Record<string, unknown> = { action };
    if (session !== null) data.admin_session = session;
    if (params !== undefined) data.params = params;
    return JSON.stringify({ msg: 'admin', msg_id: msgId, data });
}

/** `settings` / `change_cred`: the HOUSEHOLD password, not the admin one. */
export function encodeChangeCredentials(
    oldUser: string,
    oldPass: string,
    newUser: string,
    newPass: string,
): string {
    return JSON.stringify({
        msg: 'settings',
        data: {
            action: 'change_cred',
            old_user: oldUser,
            old_pw: oldPass,
            new_user: newUser,
            new_pw: newPass,
        },
    });
}

// ---------------------------------------------------------------- decoders ---

export function toNumberOrNull(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function toNumber(value: unknown, fallback = 0): number {
    return toNumberOrNull(value) ?? fallback;
}

export function toBool(value: unknown): boolean {
    return value === true || value === 'true';
}

export function isAdminErrorCode(value: unknown): value is AdminErrorCode {
    return typeof value === 'string' && (ADMIN_ERROR_CODES as readonly string[]).includes(value);
}

/** True for a `{success:'false', error, msg}` payload. */
export function isAdminFailure(data: unknown): boolean {
    return isRecord(data) && data.success !== 'true';
}

/** Reads the shared error payload; an unlisted code becomes `unknown`. */
export function toAdminError(data: unknown): AdminError {
    const record = isRecord(data) ? data : {};
    const applied = toWireString(record.applied);
    return {
        code: isAdminErrorCode(record.error) ? record.error : 'unknown',
        msg: toWireString(record.msg),
        retryAfter: toNumberOrNull(record.retry_after),
        jobId: toWireString(record.job_id),
        minLength: toNumberOrNull(record.min_length),
        apiAllowedHosts: toWireString(record.api_allowed_hosts),
        attemptsLeft: toNumberOrNull(record.attempts_left),
        max: toNumberOrNull(record.max),
        changeId: toWireString(record.change_id),
        expiresIn: toNumberOrNull(record.expires_in),
        applied: applied === '' ? [] : applied.split(','),
        failed: toWireString(record.failed),
        restartRequired: toBool(record.restart_required),
        outcomeUnknown: record.outcome === 'unknown',
    };
}

/**
 * The errors a phase-3 panel shows on its own: an action newer than the
 * daemon in memory, and a write calaos_server stopped waiting for. Neither
 * says anything about the rest of the Admin page.
 */
export function isPanelError(error: AdminError): boolean {
    return error.code === 'daemon_too_old' || error.outcomeUnknown;
}

/** An error with no detail field, for a refusal the client knows before asking. */
export function bareAdminError(code: AdminFailureCode): AdminError {
    return {
        code,
        msg: '',
        retryAfter: null,
        jobId: '',
        minLength: null,
        apiAllowedHosts: '',
        attemptsLeft: null,
        max: null,
        changeId: '',
        expiresIn: null,
        applied: [],
        failed: '',
        restartRequired: false,
        outcomeUnknown: false,
    };
}

export function clientAdminError(
    code: 'timeout' | 'disconnected' | 'household_refused' | 'busy',
): AdminError {
    return bareAdminError(code);
}

const UPGRADE_STATUSES = ['idle', 'upgrading', 'done', 'error'] as const;
const JOB_STATUSES = ['running', 'done', 'error'] as const;

export function toUpgradeStatus(raw: unknown): UpgradeStatus {
    const r = isRecord(raw) ? raw : {};
    const status = toWireString(r.status);
    return {
        status: (UPGRADE_STATUSES as readonly string[]).includes(status)
            ? (status as UpgradeStatus['status'])
            : 'unknown',
        totalPercent: Math.min(100, Math.max(0, toNumber(r.total_percent))),
        currentPkg: toWireString(r.current_pkg),
        currentStep: toWireString(r.current_step),
        pkgIndex: toNumber(r.pkg_index),
        pkgCount: toNumber(r.pkg_count),
        message: toWireString(r.message),
        error: toWireString(r.error),
        packageNames: Array.isArray(r.packages)
            ? r.packages.map((entry) => (isRecord(entry) ? toWireString(entry.name) : ''))
            : [],
    };
}

export function toUpgradeJob(raw: unknown): UpgradeJob | null {
    if (!isRecord(raw)) return null;
    const status = toWireString(raw.status);
    return {
        id: toWireString(raw.id),
        kind: toWireString(raw.kind),
        package: toWireString(raw.package),
        status: (JOB_STATUSES as readonly string[]).includes(status)
            ? (status as UpgradeJob['status'])
            : 'unknown',
        error: toWireString(raw.error),
        rebootRequired: toBool(raw.reboot_required),
        daemonRestart: toBool(raw.daemon_restart),
        startedAt: toWireString(raw.started_at),
        finishedAt: toWireString(raw.finished_at),
    };
}

/** `update_check` / `update_available`: an object keyed by package name. */
export function toUpdateList(raw: unknown): UpdateEntry[] {
    if (!isRecord(raw)) return [];
    return Object.entries(raw)
        .map(([key, value]) => {
            const r = isRecord(value) ? value : {};
            return {
                name: toWireString(r.name, key),
                version: toWireString(r.version),
                currentVersion: toWireString(r.current_version),
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}

export function toApprovers(raw: unknown): Approver[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(isRecord).map((r) => ({
        id: toWireString(r.id),
        deviceName: toWireString(r.device_name),
        tokenId: toWireString(r.token_id),
        createdAt: toWireString(r.created_at),
        platform: toWireString(r.platform),
        registeredAt: toWireString(r.registered_at),
        lastSeen: toWireString(r.last_seen),
        secure: toBool(r.secure),
    }));
}

export function toApproverCandidates(raw: unknown): ApproverCandidate[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(isRecord).map((r) => ({
        tokenId: toWireString(r.token_id),
        deviceName: toWireString(r.device_name),
        platform: toWireString(r.platform),
        registeredAt: toWireString(r.registered_at),
        lastSeen: toWireString(r.last_seen),
        approver: toBool(r.approver),
        secure: toBool(r.secure),
    }));
}

/** `code_request` and `approver_enroll` both answer a code on its way. */
export function toCodeTicket(raw: unknown): CodeTicket | null {
    if (!isRecord(raw)) return null;
    const codeId = toWireString(raw.code_id);
    if (codeId === '') return null;
    return {
        codeId,
        approverId: toWireString(raw.approver_id),
        expiresIn: toNumber(raw.expires_in, CODE_LIFETIME_S),
    };
}
