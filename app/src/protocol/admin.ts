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
/** …except `update_check`, which runs a synchronous `apt-get update`. */
export const UPDATE_CHECK_TIMEOUT_MS = 125_000;
/** `admin_unavailable`: retry every 5 s for 2 min, then every 60 s. */
export const UNAVAILABLE_FAST_RETRY_MS = 5_000;
export const UNAVAILABLE_FAST_WINDOW_MS = 120_000;
export const UNAVAILABLE_SLOW_RETRY_MS = 60_000;
/** `daemon_too_old` that lasts longer than this means the box needs a reboot. */
export const ACTIVATION_REBOOT_HINT_MS = 120_000;
/** Minimum admin password length enforced by the daemon (Unicode code points). */
export const ADMIN_PASSWORD_MIN_LENGTH = 10;

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
    'internal',
] as const;

export type AdminErrorCode = (typeof ADMIN_ERROR_CODES)[number];

/**
 * Codes the client itself produces. `timeout`: no reply within the delay — an
 * old calaos_server ignores unknown WS messages in silence. `disconnected`:
 * the socket dropped while the reply was pending. `household_refused`: the
 * server said no to `change_cred`. `unknown`: a code outside the contract (a
 * newer server), rendered as a generic failure.
 */
export type AdminFailureCode =
    | AdminErrorCode
    | 'timeout'
    | 'disconnected'
    | 'household_refused'
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

export interface UpdateEntry {
    name: string;
    version: string;
    currentVersion: string;
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
export function encodeAdminSet(newPass: string, session: string | null, msgId: string): string {
    const data =
        session === null ? { new_pass: newPass } : { new_pass: newPass, admin_session: session };
    return JSON.stringify({ msg: 'admin_set', msg_id: msgId, data });
}

/** `admin_session` is required by every action except `update_status`. */
export function encodeAdminAction(
    action: AdminAction,
    session: string | null,
    msgId: string,
    params?: Record<string, string>,
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

function toNumberOrNull(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function toNumber(value: unknown, fallback = 0): number {
    return toNumberOrNull(value) ?? fallback;
}

function toBool(value: unknown): boolean {
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
    return {
        code: isAdminErrorCode(record.error) ? record.error : 'unknown',
        msg: toWireString(record.msg),
        retryAfter: toNumberOrNull(record.retry_after),
        jobId: toWireString(record.job_id),
        minLength: toNumberOrNull(record.min_length),
        apiAllowedHosts: toWireString(record.api_allowed_hosts),
    };
}

export function clientAdminError(
    code: 'timeout' | 'disconnected' | 'household_refused',
): AdminError {
    return { code, msg: '', retryAfter: null, jobId: '', minLength: null, apiAllowedHosts: '' };
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
