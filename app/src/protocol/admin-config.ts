// `config_list` / `config_set` / `config_backup` / `config_restore` (calaos_base
// docs/08_http_api.md, "Configuration"). NO Vue imports. Handled inside
// calaos_server; the allowlist is a guard rail, not a security boundary.
// Secrets are write-only: their value never comes back.

import { isRecord, toWireString } from './guards';
import { encodeAdminAction, toBool } from './admin';

export const BACKUP_FORMAT = 'calaos-config-backup/2';
/** A `/1` document differs by its extra `widgets.xml`, which a restore ignores. */
const RESTORABLE_FORMATS: readonly string[] = ['calaos-config-backup/1', BACKUP_FORMAT];
export const BACKUP_FILES = ['io.xml', 'rules.xml', 'local_config.xml'] as const;

/** calaos_server closes a connection on a bigger frame (`max_websocket_message_size`). */
export const MAX_WEBSOCKET_MESSAGE_BYTES = 4 * 1024 * 1024;

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
    /** 0 in a `/1` document. */
    ioFormat: number;
    /** File name → content. */
    files: Record<string, string>;
}

export interface RestoreCounts {
    rooms: number;
    ios: number;
    devices: number;
    rules: number;
}

export interface ConfigRestoreResult {
    dryRun: boolean;
    files: string[];
    backup: RestoreCounts;
    box: RestoreCounts;
    ioFormat: number;
    /** Settings the box keeps whatever the backup says. */
    kept: string[];
    warnings: string[];
    /** The `backups/` folder holding the replaced files; null in a dry run. */
    previous: string | null;
    restarting: boolean;
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
    if (!isRecord(raw) || !RESTORABLE_FORMATS.includes(raw.format as string) || !isRecord(raw.files)) return null;
    const files: Record<string, string> = {};
    for (const [name, content] of Object.entries(raw.files)) {
        if (typeof content === 'string') files[name] = content;
    }
    return {
        format: raw.format as string,
        createdAt: toWireString(raw.created_at),
        serverVersion: toWireString(raw.server_version),
        hostname: toWireString(raw.hostname),
        ioFormat: toCount(raw.io_format),
        files,
    };
}

function toCount(raw: unknown): number {
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

function toCounts(raw: unknown): RestoreCounts {
    const counts = isRecord(raw) ? raw : {};
    return {
        rooms: toCount(counts.rooms),
        ios: toCount(counts.ios),
        devices: toCount(counts.devices),
        rules: toCount(counts.rules),
    };
}

function toStrings(raw: unknown): string[] {
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];
}

export function configRestoreParams(files: Record<string, string>, dryRun: boolean): Record<string, unknown> {
    return { files, dry_run: dryRun };
}

export function toConfigRestoreResult(raw: unknown): ConfigRestoreResult | null {
    if (!isRecord(raw)) return null;
    return {
        dryRun: toBool(raw.dry_run),
        files: toStrings(raw.files),
        backup: toCounts(raw.backup),
        box: toCounts(raw.box),
        ioFormat: toCount(raw.io_format),
        kept: toStrings(raw.kept),
        warnings: toStrings(raw.warnings),
        previous: typeof raw.previous === 'string' && raw.previous !== '' ? raw.previous : null,
        restarting: toBool(raw.restarting),
    };
}

/** Measured on the whole frame: JSON escapes every quote and line feed of the XML. */
export function restoreFitsOneMessage(files: Record<string, string>, session: string): boolean {
    const frame = encodeAdminAction('config_restore', session, 'admin-9999999999', configRestoreParams(files, false));
    return new TextEncoder().encode(frame).length <= MAX_WEBSOCKET_MESSAGE_BYTES;
}

// ------------------------------------------------------------ HTTP backup ---

/**
 * The HTTP form, which the browser saves as a file. The session rides in the
 * JSON body, never the URL: haproxy logs URLs.
 */
export function configBackupBody(user: string, pass: string, session: string): string {
    return JSON.stringify({ action: 'config_backup', cn_user: user, cn_pass: pass, admin_session: session });
}

/** An error answer carries no attachment header. */
export function isBackupDownload(contentDisposition: string | null): boolean {
    return contentDisposition !== null && /^\s*attachment/i.test(contentDisposition);
}

/** `calaos-backup-<hostname>-<YYYYMMDD-HHMM>.zip`, named as calaos_server sanitises its own. */
export function backupZipName(hostname: string, createdAt: string, nowMs = Date.now()): string {
    const parsed = Date.parse(createdAt);
    const when = new Date(Number.isNaN(parsed) ? nowMs : parsed);
    const stamp = when.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
    const host = hostname.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 32) || 'box';
    return `calaos-backup-${host}-${stamp}.zip`;
}
