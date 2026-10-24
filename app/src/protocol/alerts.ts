// The box's admin alerts, read back from the event log. NO Vue imports.
//
// calaos_server stores each approver alert of the daemon as a persistent push
// notification event, whose text starts with a fixed English prefix and ends
// with the phone's name in double quotes (calaos_base AdminState::alertMessage).
// The live `admin_event` carries no name, so the log is what names the phone.

import { isRecord, toWireString } from './guards';

/** `CalaosEvent::EventPushNotification` in calaos_server's event enum. */
export const PUSH_NOTIFICATION_EVENT_TYPE = '22';

const PREFIXES = {
    approver_set: 'New approver phone on your Calaos box: "',
    approver_removed: 'Approver phone removed from your Calaos box: "',
} as const;

export type AdminAlertKind = keyof typeof PREFIXES;

export interface AdminAlert {
    /** The event's uuid. */
    id: string;
    kind: AdminAlertKind;
    deviceName: string;
    /** ms since the epoch; NaN when the date did not parse. */
    at: number;
}

export function encodeEventLog(msgId: string, perPage: number): string {
    return JSON.stringify({
        msg: 'eventlog',
        msg_id: msgId,
        data: { page: '0', per_page: String(perPage) },
    });
}

/** `created_at` is SQLite's CURRENT_TIMESTAMP: UTC, `YYYY-MM-DD HH:MM:SS`. */
function toTime(value: string): number {
    return Date.parse(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value) ? `${value.replace(' ', 'T')}Z` : value);
}

function toAlert(raw: unknown): AdminAlert | null {
    if (!isRecord(raw) || toWireString(raw.event_type) !== PUSH_NOTIFICATION_EVENT_TYPE) return null;
    const body = isRecord(raw.event_raw) ? raw.event_raw : {};
    const message = toWireString(body.message);
    for (const kind of Object.keys(PREFIXES) as AdminAlertKind[]) {
        const prefix = PREFIXES[kind];
        if (!message.startsWith(prefix) || !message.endsWith('"')) continue;
        const id = toWireString(raw.id);
        if (id === '') return null;
        return { id, kind, deviceName: message.slice(prefix.length, -1), at: toTime(toWireString(raw.created_at)) };
    }
    return null;
}

/** The approver alerts of one `eventlog` page, newest first; [] for an error answer. */
export function toAdminAlerts(data: unknown): AdminAlert[] {
    if (!isRecord(data) || !Array.isArray(data.events)) return [];
    return data.events.map(toAlert).filter((alert): alert is AdminAlert => alert !== null);
}
