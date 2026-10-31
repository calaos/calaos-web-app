// `time_get` / `time_zones` / `time_set` (calaos_base docs/08_http_api.md,
// "Heure de la box"). NO Vue imports. The NTP client of Calaos OS is
// chrony.

import { isRecord, toWireString } from './guards';
import { toBool } from './admin';

/** What calaos_server accepts as `timezone`; the daemon checks it is in `time_zones`. */
export const TIMEZONE_PATTERN = /^[A-Za-z0-9_+\-/]{1,64}$/;
/** A step this large is confirmed first: going back breaks TLS validity and apt. */
export const TIME_STEP_CONFIRM_MS = 3_600_000;
export const TIME_YEAR_MIN = 2020;
export const TIME_YEAR_MAX = 2100;

export interface BoxTime {
    /** RFC 3339 UTC. */
    now: string;
    timezone: string;
    /** The NTP client is enabled. */
    ntp: boolean;
    synchronized: boolean;
    /** The hardware clock; '' when the box has none. */
    rtc: string;
}

export interface TimeSetResult {
    time: BoxTime;
    /** The timezone changed: the box's processes read it at start. */
    restartRequired: boolean;
}

/** At least one field; applied in this order by the daemon. */
export interface TimeChange {
    timezone?: string;
    ntp?: boolean;
    /** RFC 3339. */
    time?: string;
}

export function toBoxTime(raw: unknown): BoxTime | null {
    if (!isRecord(raw)) return null;
    return {
        now: toWireString(raw.now),
        timezone: toWireString(raw.timezone),
        ntp: toBool(raw.ntp),
        synchronized: toBool(raw.synchronized),
        rtc: toWireString(raw.rtc),
    };
}

export function toTimeZones(raw: unknown): string[] {
    const list = isRecord(raw) && Array.isArray(raw.timezones) ? raw.timezones : [];
    return list.filter((zone): zone is string => typeof zone === 'string' && zone !== '');
}

export function toTimeSetResult(raw: unknown): TimeSetResult | null {
    const time = toBoxTime(raw);
    if (time === null) return null;
    return { time, restartRequired: toBool((raw as Record<string, unknown>).restart_required) };
}

/** `ntp` stays a JSON boolean: `"false"` is `invalid_request`. */
export function timeSetParams(change: TimeChange): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    if (change.timezone !== undefined) params.timezone = change.timezone;
    if (change.ntp !== undefined) params.ntp = change.ntp;
    if (change.time !== undefined) params.time = change.time;
    return params;
}

/** The time as the daemon takes it: UTC, second precision. */
export function toTimeParam(ms: number): string {
    return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Box clock minus browser clock, in ms; NaN when the box time did not parse. */
export function clockDrift(time: BoxTime, browserNowMs: number): number {
    return Date.parse(time.now) - browserNowMs;
}

export type TimeStep = 'timezone' | 'ntp' | 'time';

/** A `time` step put the box clock within this of the time sent, travel included. */
export const TIME_READBACK_SLACK_MS = 60_000;

/** What a `time_set` with no answer turned out to do, from a later `time_get`. */
export interface TimeReadBack {
    changed: TimeStep[];
    unchanged: TimeStep[];
    /** The timezone is now the one sent, and was not before. */
    restartRequired: boolean;
}

/**
 * `elapsedMs` is the browser time between the send and the read: a time
 * that took has run on by that much since.
 */
export function timeReadBack(change: TimeChange, before: BoxTime | null, after: BoxTime, elapsedMs: number): TimeReadBack {
    const changed: TimeStep[] = [];
    const unchanged: TimeStep[] = [];
    const sort = (step: TimeStep, took: boolean) => (took ? changed : unchanged).push(step);
    if (change.timezone !== undefined) sort('timezone', after.timezone === change.timezone);
    if (change.ntp !== undefined) sort('ntp', after.ntp === change.ntp);
    if (change.time !== undefined) {
        const off = Date.parse(after.now) - (Date.parse(change.time) + elapsedMs);
        sort('time', Math.abs(off) <= TIME_READBACK_SLACK_MS);
    }
    const restartRequired =
        change.timezone !== undefined && after.timezone === change.timezone && before?.timezone !== change.timezone;
    return { changed, unchanged, restartRequired };
}

/** The `<input type="datetime-local" step="1">` value format. */
const LOCAL_PATTERN = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Throws a RangeError for a zone this browser does not know. One formatter per zone: they are costly to build. */
function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
    let format = formatters.get(timeZone);
    if (format === undefined) {
        format = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
        formatters.set(timeZone, format);
    }
    return format;
}

/** The wall clock of `timeZone` at `ms`, read as if it were UTC. */
function wallClockMs(ms: number, timeZone: string): number {
    const parts = zoneFormatter(timeZone).formatToParts(ms);
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
}

/** True when this browser can read the wall clock of `timeZone`. */
export function knowsZone(timeZone: string): boolean {
    try {
        zoneFormatter(timeZone);
        return true;
    } catch {
        return false;
    }
}

/** "2026-10-31T14:05:09", the wall clock of `timeZone` at `ms`; '' for a zone this browser does not know. */
export function toLocalInput(ms: number, timeZone: string): string {
    return knowsZone(timeZone) ? new Date(wallClockMs(ms, timeZone)).toISOString().slice(0, 19) : '';
}

export type LocalTimeResult = { ms: number } | { error: 'invalid' | 'range' | 'nonexistent' | 'zone' };

/**
 * A wall-clock time typed for the box, read in the box's time zone and not
 * the browser's. A time repeated when the clocks go back is the first one;
 * one skipped when they go forward does not exist. A zone this browser does
 * not know is an error: guessing UTC would send a wrong time.
 */
export function fromLocalInput(value: string, timeZone: string): LocalTimeResult {
    const match = LOCAL_PATTERN.exec(value);
    if (match === null) return { error: 'invalid' };
    const [, y, mo, d, h, mi, s] = match;
    const wall = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
    if (Number.isNaN(wall) || new Date(wall).toISOString().slice(0, 19) !== `${y}-${mo}-${d}T${h}:${mi}:${s ?? '00'}`) {
        return { error: 'invalid' };
    }
    if (!knowsZone(timeZone)) return { error: 'zone' };
    // The offsets in force a day either side bracket any transition near `wall`.
    const day = 86_400_000;
    const offset = (ms: number) => wallClockMs(ms, timeZone) - ms;
    const candidates = [offset(wall - day), offset(wall + day)]
        .map((o) => wall - o)
        .filter((ms) => wallClockMs(ms, timeZone) === wall);
    if (candidates.length === 0) return { error: 'nonexistent' };
    const ms = Math.min(...candidates);
    // The daemon bounds the year of the UTC instant, not of the typed wall clock.
    const year = new Date(ms).getUTCFullYear();
    return year < TIME_YEAR_MIN || year > TIME_YEAR_MAX ? { error: 'range' } : { ms };
}

/** Case, spaces and underscores do not matter: "new york" finds America/New_York. */
export function filterZones(zones: string[], query: string): string[] {
    const norm = (s: string) => s.toLowerCase().replace(/[\s_]+/g, '');
    const needle = norm(query);
    return needle === '' ? zones : zones.filter((zone) => norm(zone).includes(needle));
}
