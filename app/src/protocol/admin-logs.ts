// `logs_sources` / `logs_query` (calaos_base docs/08_http_api.md, "Logs").
// NO Vue imports. The daemon bounds, filters and masks; the client pages by
// cursor and follows by repeating a `forward` query every 2 s: there is no
// stream and no server-side state.

import { isRecord, toWireString } from './guards';
import { toBool, toNumberOrNull } from './admin';

/** The daemon's list, in its order; the webapp translates by `id`. */
export const LOG_SOURCE_IDS = [
    'calaos-server',
    'calaos-home',
    'haproxy',
    'mosquitto',
    'zigbee2mqtt',
    'influxdb',
    'grafana',
    'hue2mqtt',
    'envoy',
    'calaos-container',
    'olad',
    'timesyncd',
    'calaos-ddns',
    'networkd',
    'ssh',
    'kernel',
    'system',
] as const;

/** syslog levels, index = number. */
export const LOG_PRIORITIES = ['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug'] as const;
export type LogPriorityName = (typeof LOG_PRIORITIES)[number];

export const LOG_SOURCES_MAX = 8;
export const LOG_TEXT_MAX = 256;
export const LOG_LINES_MAX = 1000;
export const LOG_LINES_DEFAULT = 200;
export const LOG_CURSOR_MAX = 512;
/** Follow cadence; the daemon allows 2 queries per second per session. */
export const LOG_FOLLOW_INTERVAL_MS = 2_000;

export interface LogSource {
    id: string;
    /** Fixed English text, for an id the catalogue does not know. */
    label: string;
}

export interface LogEntry {
    cursor: string;
    /** RFC 3339 UTC with milliseconds. */
    ts: string;
    source: string;
    unit: string;
    /** 0 (emerg) to 7 (debug). */
    priority: number;
    pid: number | null;
    message: string;
    /** The message was cut at 2048 bytes. */
    cut: boolean;
}

export interface LogPage {
    /** Oldest first, in both directions. */
    entries: LogEntry[];
    /** The 1 MiB budget cut the answer. */
    truncated: boolean;
    /** false: the scan window ended before `lines` matches; still a success. */
    complete: boolean;
    /** Where to go on in the same direction; null when nothing was scanned. */
    nextCursor: string | null;
}

export interface LogQuery {
    sources?: string[];
    /** The highest level shown. */
    priority?: LogPriorityName | number;
    since?: string;
    until?: string;
    text?: string;
    lines?: number;
    cursor?: string;
    direction?: 'backward' | 'forward';
}

export function toLogSources(raw: unknown): LogSource[] {
    const list = isRecord(raw) && Array.isArray(raw.sources) ? raw.sources : [];
    return list
        .filter(isRecord)
        .map((r) => ({ id: toWireString(r.id), label: toWireString(r.label) }))
        .filter((source) => source.id !== '');
}

function toEntry(r: Record<string, unknown>): LogEntry {
    const priority = toNumberOrNull(r.priority);
    return {
        cursor: toWireString(r.cursor),
        ts: toWireString(r.ts),
        source: toWireString(r.source),
        unit: toWireString(r.unit),
        priority: priority !== null && priority >= 0 && priority <= 7 ? Math.trunc(priority) : 6,
        pid: toNumberOrNull(r.pid),
        message: toWireString(r.message),
        cut: toBool(r.cut),
    };
}

export function toLogPage(raw: unknown): LogPage {
    const r = isRecord(raw) ? raw : {};
    const entries = Array.isArray(r.entries) ? r.entries.filter(isRecord).map(toEntry) : [];
    const next = toWireString(r.next_cursor);
    return {
        entries,
        truncated: toBool(r.truncated),
        complete: r.complete === undefined ? true : toBool(r.complete),
        nextCursor: next === '' ? null : next,
    };
}

/**
 * The `params` of one query, with the JSON types calaos_server insists on
 * (`lines` and a numeric `priority` as numbers, `sources` an array): a
 * string where a number belongs is `invalid_request`. Empty fields are left out.
 */
export function logQueryParams(query: LogQuery): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    if (query.sources !== undefined && query.sources.length > 0) params.sources = [...query.sources];
    if (query.priority !== undefined) params.priority = query.priority;
    if (query.since !== undefined && query.since !== '') params.since = query.since;
    if (query.until !== undefined && query.until !== '') params.until = query.until;
    if (query.text !== undefined && query.text !== '') params.text = query.text;
    if (query.lines !== undefined) params.lines = Math.trunc(query.lines);
    if (query.cursor !== undefined && query.cursor !== '') params.cursor = query.cursor;
    if (query.direction !== undefined) params.direction = query.direction;
    return params;
}

/** The checks calaos_server makes before calling the daemon; '' when the query passes. */
export function logQueryProblem(query: LogQuery): string {
    const sources = query.sources ?? [];
    if (sources.length > LOG_SOURCES_MAX) return 'sources';
    if (sources.some((id) => !(LOG_SOURCE_IDS as readonly string[]).includes(id))) return 'sources';
    if (typeof query.priority === 'number' && !(Number.isInteger(query.priority) && query.priority >= 0 && query.priority <= 7)) {
        return 'priority';
    }
    if (query.text !== undefined && [...query.text].length > LOG_TEXT_MAX) return 'text';
    if (query.lines !== undefined && !(Number.isInteger(query.lines) && query.lines >= 1 && query.lines <= LOG_LINES_MAX)) {
        return 'lines';
    }
    if (query.cursor !== undefined && (query.cursor.length > LOG_CURSOR_MAX || !/^[\x20-\x7e]*$/.test(query.cursor))) {
        return 'cursor';
    }
    const since = query.since ? Date.parse(query.since) : NaN;
    const until = query.until ? Date.parse(query.until) : NaN;
    if (query.since && !Number.isFinite(since)) return 'since';
    if (query.until && !Number.isFinite(until)) return 'until';
    if (Number.isFinite(since) && Number.isFinite(until) && since >= until) return 'since';
    if (query.direction === 'forward' && !query.cursor && !query.since) return 'direction';
    return '';
}

/** The level name of an entry's number, for display and CSS classes. */
export function priorityName(priority: number): LogPriorityName {
    return LOG_PRIORITIES[Math.min(7, Math.max(0, Math.trunc(priority)))];
}
