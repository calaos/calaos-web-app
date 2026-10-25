// `config_list` / `config_set` / `config_backup` (calaos_base
// docs/08_http_api.md, "Configuration"). NO Vue imports. Handled inside
// calaos_server; the allowlist is a guard rail, not a security boundary.
// Secrets are write-only: their value never comes back.

import { isRecord, toWireString } from './guards';
import { toBool } from './admin';

export const BACKUP_FORMAT = 'calaos-config-backup/1';
export const BACKUP_FILES = ['io.xml', 'rules.xml', 'local_config.xml', 'widgets.xml'] as const;

export interface ConfigOption {
    key: string;
    group: string;
    /** The registry's type (`bool`, `int`, `string`, …), passed through. */
    type: string;
    description: string;
    /** null for a secret: never sent. */
    value: string | null;
    default: string;
    secret: boolean;
    /** A value is stored (the only thing a secret tells). */
    set: boolean;
    /** Taken into account after a restart of calaos-server. */
    restart: boolean;
    /** The registry's allowed values, when it has a list. */
    choices: string[] | null;
}

export interface ConfigSetResult {
    key: string;
    /** null for a secret. */
    value: string | null;
    set: boolean;
    restartRequired: boolean;
}

export interface ConfigBackup {
    format: string;
    createdAt: string;
    serverVersion: string;
    hostname: string;
    /** File name → content. */
    files: Record<string, string>;
}

function toChoices(raw: unknown): string[] | null {
    if (!Array.isArray(raw)) return null;
    return raw.map((choice) => toWireString(choice));
}

export function toConfigOptions(raw: unknown): ConfigOption[] {
    const list = isRecord(raw) && Array.isArray(raw.options) ? raw.options : [];
    return list.filter(isRecord).map((r) => {
        const secret = toBool(r.secret);
        return {
            key: toWireString(r.key),
            group: toWireString(r.group),
            type: toWireString(r.type),
            description: toWireString(r.description),
            value: secret || r.value === undefined || r.value === null ? null : toWireString(r.value),
            default: toWireString(r.default),
            secret,
            set: toBool(r.set),
            restart: toBool(r.restart),
            choices: toChoices(r.choices),
        };
    });
}

export function toConfigSetResult(raw: unknown): ConfigSetResult | null {
    if (!isRecord(raw)) return null;
    const key = toWireString(raw.key);
    if (key === '') return null;
    const hasValue = typeof raw.value === 'string';
    return {
        key,
        value: hasValue ? (raw.value as string) : null,
        set: raw.set === undefined ? hasValue && raw.value !== '' : toBool(raw.set),
        restartRequired: toBool(raw.restart_required),
    };
}

/** `value` is always a string; '' restores the default. */
export function configSetParams(key: string, value: string): { key: string; value: string } {
    return { key, value };
}

export function toConfigBackup(raw: unknown): ConfigBackup | null {
    if (!isRecord(raw) || raw.format !== BACKUP_FORMAT || !isRecord(raw.files)) return null;
    const files: Record<string, string> = {};
    for (const [name, content] of Object.entries(raw.files)) {
        if (typeof content === 'string') files[name] = content;
    }
    return {
        format: BACKUP_FORMAT,
        createdAt: toWireString(raw.created_at),
        serverVersion: toWireString(raw.server_version),
        hostname: toWireString(raw.hostname),
        files,
    };
}

// ------------------------------------------------------------ HTTP backup ---

/**
 * The HTTP form, which the browser saves as a file. The session rides in the
 * JSON body, never the URL: haproxy logs URLs.
 */
export function configBackupBody(user: string, pass: string, session: string): string {
    return JSON.stringify({ action: 'config_backup', cn_user: user, cn_pass: pass, admin_session: session });
}

/** `calaos-backup-<hostname>-<YYYYMMDD-HHMM>.json`, as calaos_server sanitises it. */
const BACKUP_FILENAME = /^calaos-backup-[A-Za-z0-9._-]{1,32}-\d{8}-\d{4}\.json$/;

/**
 * The file name of `Content-Disposition`, or '' when the header is absent:
 * an error answer carries none. Anything outside the server's own pattern
 * is replaced, so a header cannot pick where or what the browser saves.
 */
export function backupFilename(contentDisposition: string | null, fallbackHost = 'box', nowMs = Date.now()): string {
    if (contentDisposition === null || !/^\s*attachment/i.test(contentDisposition)) return '';
    const match = /filename="([^"]*)"/i.exec(contentDisposition);
    const name = match?.[1] ?? '';
    if (BACKUP_FILENAME.test(name)) return name;
    const stamp = new Date(nowMs).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
    const host = fallbackHost.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 32) || 'box';
    return `calaos-backup-${host}-${stamp}.json`;
}
