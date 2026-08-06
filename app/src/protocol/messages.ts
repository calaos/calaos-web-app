// Message codecs: exact wire frames sent to calaos_server, and the decoder
// for everything received. NO Vue imports in this directory.
//
// Encoders return the exact JSON string that goes on the websocket (the old
// app did ws.send(JSON.stringify(obj)) — key order is preserved here so tests
// can assert byte-exact frames). All wire values are STRINGS.

import { toAudioPlayerState, toSeconds } from './audio';
import { isRecord, toHomeData, toWireString } from './guards';
import type { AudioPlayerState, IoChangedMessage, ServerMessage } from './types';

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

/**
 * Detailed state for a batch of ios — ONE frame for the whole audio list, not
 * one per player (docs/audio-protocol.md "get_state"). Audio players expand
 * to an object here, which is the only way to learn a player's status, volume,
 * position and current track: get_home carries none of it.
 *
 * No `msg_id`: the answer is a map keyed by io id, so every entry already says
 * what it answers and there is nothing to correlate.
 */
export function encodeGetState(items: string[]): string {
    return JSON.stringify({ msg: 'get_state', data: { items } });
}

/** The `audio_action`s the app sends. The rest of the table is out of scope. */
export type AudioAction = 'get_cover_url' | 'get_time';

/**
 * An `{msg:"audio"}` query.
 *
 * `msgId` is mandatory, and not out of politeness: the answer is
 * `{"msg":"audio","data":{"cover":"…"}}` with no player id anywhere in it, so
 * the verbatim msg_id echo is the only link back to the request. The value is
 * an opaque client token — the server never interprets it.
 */
export function encodeAudioQuery(action: AudioAction, id: string, msgId: string): string {
    return JSON.stringify({ msg: 'audio', msg_id: msgId, data: { audio_action: action, id } });
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

        case 'get_state': {
            // One flat map holding two kinds of entry: a plain io maps to its
            // state string, an audio player maps to a detail object
            // (JsonApi::buildJsonState). Split by shape — the frame carries no
            // marker saying which is which. A data-less answer (the server's
            // reply to a data-less request) decodes to two empty maps.
            const data = isRecord(obj.data) ? obj.data : {};
            const ios: Record<string, string> = {};
            const players: Record<string, AudioPlayerState> = {};
            // One clock reading for the whole batch: every player's position
            // was measured server-side at the same moment.
            const at = Date.now();
            for (const [id, value] of Object.entries(data)) {
                if (isRecord(value)) players[id] = toAudioPlayerState(value, at);
                else ios[id] = toWireString(value);
            }
            return { kind: 'get_state', msgId: toWireString(obj.msg_id), ios, players };
        }

        case 'audio': {
            const data = isRecord(obj.data) ? obj.data : {};
            return {
                kind: 'audio_query',
                msgId: toWireString(obj.msg_id),
                error: toWireString(data.error),
                cover: toWireString(data.cover),
                // null vs 0 matters: 'the reply was not about time' is not the
                // same claim as 'the player is at the start'.
                timeElapsed: 'time_elapsed' in data ? toSeconds(data.time_elapsed) : null,
            };
        }

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
