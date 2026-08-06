// Message codecs: exact wire frames sent to calaos_server, and the decoder
// for everything received. NO Vue imports in this directory.
//
// Encoders return the exact JSON string that goes on the websocket (the old
// app did ws.send(JSON.stringify(obj)) — key order is preserved here so tests
// can assert byte-exact frames). All wire values are STRINGS.

import { isRecord, toHomeData, toWireString } from './guards';
import type { IoChangedMessage, ServerMessage } from './types';

export function encodeLogin(user: string, pass: string): string {
    return JSON.stringify({ msg: 'login', data: { cn_user: user, cn_pass: pass } });
}

export function encodeGetHome(): string {
    return JSON.stringify({ msg: 'get_home' });
}

// `value` is the raw wire action string: 'true', 'false', 'up', 'down',
// 'stop', 'inc', 'dec', 'set <0-100>', 'set <#rrggbb>' — or raw text for
// string IOs (NO 'set ' prefix). Builders live in io-states.ts.
export function encodeSetState(id: string, value: string): string {
    return JSON.stringify({ msg: 'set_state', data: { id, value } });
}

// Decode any frame received from the server. Accepts the raw websocket string
// (or an already-parsed value, for tests). NEVER throws: malformed or
// unrecognized input returns the typed { kind: 'unknown' } fallback.
export function decodeServerMessage(raw: unknown): ServerMessage {
    let obj: unknown = raw;
    if (typeof raw === 'string') {
        try {
            obj = JSON.parse(raw);
        } catch {
            console.warn('calaos protocol: unparseable frame:', raw);
            return { kind: 'unknown', raw };
        }
    }

    if (!isRecord(obj)) {
        console.warn('calaos protocol: malformed frame:', obj);
        return { kind: 'unknown', raw: obj };
    }

    switch (obj.msg) {
        case 'login': {
            const data = isRecord(obj.data) ? obj.data : {};
            // Success is compared to the STRING 'true' (old code:
            // `obj.data.success !== 'true'` → failed). A JSON boolean true
            // would NOT authenticate, exactly like the old app.
            return { kind: 'login', success: data.success === 'true' };
        }

        case 'get_home':
            return { kind: 'get_home', home: toHomeData(obj.data) };

        case 'event': {
            const data = isRecord(obj.data) ? obj.data : {};
            const inner = isRecord(data.data) ? data.data : {};
            const id = inner.id;
            if (
                data.type_str === 'io_changed' &&
                (typeof id === 'string' || typeof id === 'number')
            ) {
                // Patch semantics: state/name only when the event carried the
                // key (old code checked hasOwnProperty before assigning). An
                // io_changed without an id fell through to the old "event not
                // implemented" branch, i.e. it was ignored — same here via
                // unknown_event.
                const msg: IoChangedMessage = { kind: 'io_changed', id: String(id) };
                if ('state' in inner) msg.state = toWireString(inner.state);
                if ('name' in inner) msg.name = toWireString(inner.name);
                return msg;
            }
            // Well-formed event the app does not implement yet (new_io,
            // delete_io, modify_room, new_room, delete_room, audio_*...): the
            // home store's dispatch table stubs these — no warn.
            return {
                kind: 'unknown_event',
                typeStr: toWireString(data.type_str),
                data: data.data,
            };
        }

        default:
            console.warn('calaos protocol: unknown message:', obj);
            return { kind: 'unknown', raw: obj };
    }
}
