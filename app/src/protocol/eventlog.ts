// The generic reader of calaos_server's `eventlog` (docs/08_http_api.md). NO
// Vue imports. protocol/alerts.ts keeps its own narrower reading of the same
// frames for the approver banner.
//
// The reply is the one place with real JSON integers (total_page, page, ...);
// they are read through Number() so a stringified one still works.

import { isRecord, toWireString } from './guards';
import { toTime } from './alerts';

export interface EventLogEvent {
    id: string;
    /** The server's CalaosEvent enum value, as sent (a string). */
    eventType: string;
    ioId: string;
    ioState: string;
    /** Names the JPEG served by `action=event_picture`; '' for no picture. */
    picUid: string;
    /** ms since the epoch; NaN when the date did not parse. */
    at: number;
    /** The server's `event_raw` object, untouched. */
    raw: Record<string, unknown>;
}

export type EventLogPageResult =
    | { ok: true; events: EventLogEvent[]; page: number; totalPages: number; totalCount: number }
    | { ok: false; error: string };

export type EventLogDetailResult = { ok: true; event: EventLogEvent } | { ok: false; error: string };

/** A single event by uuid: the answer is the event object alone, without paging. */
export function encodeEventDetail(msgId: string, uuid: string): string {
    return JSON.stringify({ msg: 'eventlog', msg_id: msgId, data: { uuid } });
}

function toCount(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export function toEventLogEvent(raw: unknown): EventLogEvent | null {
    if (!isRecord(raw)) return null;
    const id = toWireString(raw.id);
    if (id === '') return null;
    // event_raw is an object on the wire; a JSON string (older boxes) is not parsed.
    const body = isRecord(raw.event_raw) ? raw.event_raw : {};
    // The row column wins; event_raw.pic_uid is what a push notification carries.
    const picUid = toWireString(raw.pic_uid) || toWireString(body.pic_uid);
    return {
        id,
        eventType: toWireString(raw.event_type),
        ioId: toWireString(raw.io_id),
        ioState: toWireString(raw.io_state),
        picUid,
        at: toTime(toWireString(raw.created_at)),
        raw: body,
    };
}

function errorOf(data: unknown): string {
    return isRecord(data) ? toWireString(data.error, 'unexpected answer') : 'unexpected answer';
}

export function decodeEventLogPage(data: unknown): EventLogPageResult {
    if (!isRecord(data) || !Array.isArray(data.events)) return { ok: false, error: errorOf(data) };
    const events = data.events.map(toEventLogEvent).filter((event): event is EventLogEvent => event !== null);
    return {
        ok: true,
        events,
        page: toCount(data.page),
        totalPages: toCount(data.total_page),
        totalCount: toCount(data.total_count),
    };
}

export function decodeEventLogDetail(data: unknown): EventLogDetailResult {
    const event = isRecord(data) && !('error' in data) ? toEventLogEvent(data) : null;
    return event === null ? { ok: false, error: errorOf(data) } : { ok: true, event };
}
