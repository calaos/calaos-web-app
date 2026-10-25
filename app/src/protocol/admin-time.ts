// `time_get` / `time_zones` / `time_set` (calaos_base docs/08_http_api.md,
// "Heure de la box"). NO Vue imports. The NTP client of Calaos OS is
// systemd-timesyncd.

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
    /** timesyncd is enabled. */
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
