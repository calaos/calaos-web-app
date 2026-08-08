import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    decodeServerMessage,
    encodeAudioQuery,
    encodeGetHome,
    encodeGetState,
    encodeLogin,
    encodeSetState,
} from './messages';
import { setColor, setPercent, setText } from './io-states';
import { AUDIO_PREVIOUS, volumeSet } from './audio';

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('encoders — exact wire JSON (all values are strings)', () => {
    it('encodeLogin', () => {
        expect(encodeLogin('demo', 'demo')).toBe(
            '{"msg":"login","data":{"cn_user":"demo","cn_pass":"demo"}}',
        );
    });

    it('encodeGetHome', () => {
        expect(encodeGetHome()).toBe('{"msg":"get_home"}');
    });

    it.each([
        ['true', '{"msg":"set_state","data":{"id":"io_9","value":"true"}}'],
        ['false', '{"msg":"set_state","data":{"id":"io_9","value":"false"}}'],
        ['up', '{"msg":"set_state","data":{"id":"io_9","value":"up"}}'],
        ['down', '{"msg":"set_state","data":{"id":"io_9","value":"down"}}'],
        ['stop', '{"msg":"set_state","data":{"id":"io_9","value":"stop"}}'],
        ['inc', '{"msg":"set_state","data":{"id":"io_9","value":"inc"}}'],
        ['dec', '{"msg":"set_state","data":{"id":"io_9","value":"dec"}}'],
    ])('encodeSetState value %o', (value, frame) => {
        expect(encodeSetState('io_9', value)).toBe(frame);
    });

    it('dimmer slider commit uses the "set " prefix', () => {
        expect(encodeSetState('io_2', setPercent(50))).toBe(
            '{"msg":"set_state","data":{"id":"io_2","value":"set 50"}}',
        );
    });

    it('rgb picker uses the "set " prefix with the hex color', () => {
        expect(encodeSetState('io_3', setColor('#ff2200'))).toBe(
            '{"msg":"set_state","data":{"id":"io_3","value":"set #ff2200"}}',
        );
    });

    it('string IO dialog sends RAW text with NO "set " prefix', () => {
        expect(encodeSetState('io_4', setText('hello world'))).toBe(
            '{"msg":"set_state","data":{"id":"io_4","value":"hello world"}}',
        );
        // Even text starting with "set " goes through untouched.
        expect(encodeSetState('io_4', setText('set in stone'))).toBe(
            '{"msg":"set_state","data":{"id":"io_4","value":"set in stone"}}',
        );
    });
});

describe('decodeServerMessage — login', () => {
    it.each([
        ['true', true],
        ['false', false],
        // Only the STRING 'true' authenticates (old code: success !== 'true')
        // — a JSON boolean true does NOT.
        [true, false],
        ['TRUE', false],
        [undefined, false],
    ])('data.success %o → success %s', (success, expected) => {
        const frame = JSON.stringify({ msg: 'login', data: { success } });
        expect(decodeServerMessage(frame)).toEqual({ kind: 'login', success: expected });
    });

    it('tolerates a login frame with no data', () => {
        expect(decodeServerMessage('{"msg":"login"}')).toEqual({ kind: 'login', success: false });
    });
});

describe('decodeServerMessage — get_home', () => {
    it('converts the payload through the guards (visible/rw → booleans, hits → number)', () => {
        const frame = JSON.stringify({
            msg: 'get_home',
            data: {
                home: [
                    {
                        name: 'Salon',
                        type: 'lounge',
                        hits: '3',
                        items: [
                            {
                                id: 'io_0',
                                name: 'Lampe',
                                gui_type: 'light',
                                state: 'false',
                                visible: 'true',
                                rw: 'true',
                                unit: '',
                            },
                        ],
                    },
                ],
                cameras: [{ id: '0', name: 'Cam' }],
                audio: [],
            },
        });
        expect(decodeServerMessage(frame)).toEqual({
            kind: 'get_home',
            home: {
                rooms: [
                    {
                        name: 'Salon',
                        type: 'lounge',
                        hits: 3,
                        items: [
                            {
                                id: 'io_0',
                                name: 'Lampe',
                                guiType: 'light',
                                ioStyle: '',
                                state: 'false',
                                visible: true,
                                rw: true,
                                unit: '',
                                status: null,
                            },
                        ],
                    },
                ],
                cameras: [{ id: '0', name: 'Cam' }],
                audio: [],
            },
        });
    });

    it('yields an empty typed home when data is missing', () => {
        expect(decodeServerMessage('{"msg":"get_home"}')).toEqual({
            kind: 'get_home',
            home: { rooms: [], cameras: [], audio: [] },
        });
    });
});

describe('decodeServerMessage — events', () => {
    it('decodes io_changed with state and name patch fields', () => {
        const frame = JSON.stringify({
            msg: 'event',
            data: { type_str: 'io_changed', data: { id: 'io_5', state: 'true', name: 'New name' } },
        });
        expect(decodeServerMessage(frame)).toEqual({
            kind: 'io_changed',
            id: 'io_5',
            state: 'true',
            name: 'New name',
        });
    });

    it('omits patch fields the event did not carry (hasOwnProperty semantics)', () => {
        const frame = JSON.stringify({
            msg: 'event',
            data: { type_str: 'io_changed', data: { id: 'io_5', state: 'up 30' } },
        });
        const msg = decodeServerMessage(frame);
        expect(msg).toEqual({ kind: 'io_changed', id: 'io_5', state: 'up 30' });
        expect(msg).not.toHaveProperty('name');
    });

    it('coerces a numeric id to a string', () => {
        const frame = JSON.stringify({
            msg: 'event',
            data: { type_str: 'io_changed', data: { id: 12, state: '0' } },
        });
        expect(decodeServerMessage(frame)).toEqual({ kind: 'io_changed', id: '12', state: '0' });
    });

    it('io_changed without an id is ignored as unknown_event (old app dropped it too)', () => {
        const frame = JSON.stringify({
            msg: 'event',
            data: { type_str: 'io_changed', data: { state: 'true' } },
        });
        expect(decodeServerMessage(frame)).toEqual({
            kind: 'unknown_event',
            typeStr: 'io_changed',
            data: { state: 'true' },
        });
    });

    it.each([['new_io'], ['delete_io'], ['modify_room'], ['audio_status']])(
        'passes not-yet-implemented event %o through as unknown_event',
        (typeStr) => {
            const frame = JSON.stringify({ msg: 'event', data: { type_str: typeStr, data: { id: '1' } } });
            expect(decodeServerMessage(frame)).toEqual({
                kind: 'unknown_event',
                typeStr,
                data: { id: '1' },
            });
        },
    );

    it('tolerates an event frame with no data at all', () => {
        expect(decodeServerMessage('{"msg":"event"}')).toEqual({
            kind: 'unknown_event',
            typeStr: '',
            data: undefined,
        });
    });
});

describe('decodeServerMessage — malformed frames never throw', () => {
    it.each([
        ['not json at all'],
        ['{"msg":"login","data":'],
        [''],
        ['42'],
        ['null'],
        ['[1,2,3]'],
        ['"just a string"'],
    ])('string frame %o → kind unknown', (frame) => {
        expect(() => decodeServerMessage(frame)).not.toThrow();
        expect(decodeServerMessage(frame).kind).toBe('unknown');
        expect(console.warn).toHaveBeenCalled();
    });

    it.each([
        [null],
        [undefined],
        [42],
        [true],
        [[]],
        [{}],
        [{ msg: 'unheard_of' }],
        [{ msg: 42 }],
        [{ data: { success: 'true' } }],
    ])('non-string garbage %o → kind unknown', (input) => {
        expect(() => decodeServerMessage(input)).not.toThrow();
        expect(decodeServerMessage(input).kind).toBe('unknown');
    });

    it('accepts an already-parsed object (same result as the JSON string)', () => {
        expect(decodeServerMessage({ msg: 'login', data: { success: 'true' } })).toEqual({
            kind: 'login',
            success: true,
        });
    });
});

// ---------------------------------------------------------------------------
// audio (docs/audio-protocol.md)
// ---------------------------------------------------------------------------

describe('encodeGetState', () => {
    it('asks about a whole batch in ONE frame', () => {
        expect(encodeGetState(['audio_1', 'audio_2'])).toBe(
            '{"msg":"get_state","data":{"items":["audio_1","audio_2"]}}',
        );
    });

    // No msg_id: the answer is a map keyed by io id, so every entry already
    // says what it answers.
    it('carries no msg_id', () => {
        expect(encodeGetState(['audio_1'])).not.toContain('msg_id');
    });
});

describe('encodeAudioQuery', () => {
    // The msg_id is load-bearing here, not politeness: an `audio` reply has no
    // player id in it, so the echo is the only link back to the request.
    it('carries the correlating msg_id and the action/id pair', () => {
        expect(encodeAudioQuery('get_cover_url', 'audio_1', 'cover-7')).toBe(
            '{"msg":"audio","msg_id":"cover-7","data":{"audio_action":"get_cover_url","id":"audio_1"}}',
        );
    });

    it('builds a get_time query the same way', () => {
        expect(encodeAudioQuery('get_time', 'audio_2', 't-1')).toBe(
            '{"msg":"audio","msg_id":"t-1","data":{"audio_action":"get_time","id":"audio_2"}}',
        );
    });
});

describe('encodeSetState — audio commands ride the ordinary set_state', () => {
    it('sends a transport verb as a plain value', () => {
        expect(encodeSetState('audio_1', AUDIO_PREVIOUS)).toBe(
            '{"msg":"set_state","data":{"id":"audio_1","value":"previous"}}',
        );
    });

    it('sends volume as one string, not as a structured field', () => {
        expect(encodeSetState('audio_1', volumeSet(55))).toBe(
            '{"msg":"set_state","data":{"id":"audio_1","value":"volume set 55"}}',
        );
    });
});

describe('decodeServerMessage — get_state', () => {
    it('splits the flat map into plain ios and expanded players', () => {
        const msg = decodeServerMessage({
            msg: 'get_state',
            msg_id: '1',
            data: {
                output_1: 'true',
                audio_1: {
                    playlist_current_track: '1',
                    volume: '35',
                    playlist_size: '3',
                    time_elapsed: '42.5',
                    status: 'playing',
                    current_track: { title: 'T', artist: 'A', album: 'B', duration: '187.2' },
                },
            },
        });

        expect(msg.kind).toBe('get_state');
        if (msg.kind !== 'get_state') return;
        expect(msg.msgId).toBe('1');
        // Split by SHAPE: the frame carries no marker saying which is which.
        expect(msg.ios).toEqual({ output_1: 'true' });
        expect(Object.keys(msg.players)).toEqual(['audio_1']);
        expect(msg.players.audio_1.status).toBe('playing');
        expect(msg.players.audio_1.volume).toBe(35);
        expect(msg.players.audio_1.track.title).toBe('T');
    });

    it('anchors every player in the batch to one clock reading', () => {
        const msg = decodeServerMessage({
            msg: 'get_state',
            data: { audio_1: { status: 'playing' }, audio_2: { status: 'stop' } },
        });
        if (msg.kind !== 'get_state') throw new Error('expected get_state');
        expect(msg.players.audio_1.anchoredAt).toBe(msg.players.audio_2.anchoredAt);
    });

    // The server answers a data-less get_state without data (processGetState).
    it('decodes the data-less answer to two empty maps', () => {
        const msg = decodeServerMessage({ msg: 'get_state' });
        expect(msg).toEqual({ kind: 'get_state', msgId: '', ios: {}, players: {} });
    });
});

describe('decodeServerMessage — audio queries', () => {
    it('reads a get_cover_url answer, keeping the correlating msg_id', () => {
        expect(
            decodeServerMessage({
                msg: 'audio',
                msg_id: 'cover-3',
                data: { cover: 'http://lms:9000/music/17/cover.jpg' },
            }),
        ).toEqual({
            kind: 'audio_query',
            msgId: 'cover-3',
            error: '',
            cover: 'http://lms:9000/music/17/cover.jpg',
            timeElapsed: null,
        });
    });

    it('reads an empty cover as an answer, not as a failure', () => {
        const msg = decodeServerMessage({ msg: 'audio', msg_id: 'c', data: { cover: '' } });
        if (msg.kind !== 'audio_query') throw new Error('expected audio_query');
        expect(msg.cover).toBe('');
        expect(msg.error).toBe('');
    });

    // Upstream's error strings, typos included — they are passed through
    // rather than re-spelled, so a live diff against the server is possible.
    it.each([['unkown audio_action'], ['empty player id'], ['unkown player_id'], ['wrong item']])(
        'passes the upstream error %o straight through',
        (error) => {
            const msg = decodeServerMessage({ msg: 'audio', data: { error } });
            if (msg.kind !== 'audio_query') throw new Error('expected audio_query');
            expect(msg.error).toBe(error);
        },
    );

    it('distinguishes "no time in this reply" from "at the start"', () => {
        const absent = decodeServerMessage({ msg: 'audio', data: { cover: '' } });
        const zero = decodeServerMessage({ msg: 'audio', data: { time_elapsed: '0' } });
        if (absent.kind !== 'audio_query' || zero.kind !== 'audio_query') {
            throw new Error('expected audio_query');
        }
        expect(absent.timeElapsed).toBeNull();
        expect(zero.timeElapsed).toBe(0);
    });

    it('reads a get_time answer as a number', () => {
        const msg = decodeServerMessage({ msg: 'audio', data: { time_elapsed: '42.5' } });
        if (msg.kind !== 'audio_query') throw new Error('expected audio_query');
        expect(msg.timeElapsed).toBe(42.5);
    });
});

describe('decodeServerMessage — audio events', () => {
    // Audio events stay generic event frames: the home store's dispatch table
    // decides what to do with them, so the decoder needs no case per type.
    it.each([['audio_status_changed'], ['audio_volume_changed'], ['audio_song_changed']])(
        'decodes %s to an event carrying its raw payload',
        (typeStr) => {
            const msg = decodeServerMessage({
                msg: 'event',
                data: {
                    event_raw: `${typeStr} player_id:audio_1`,
                    type: '19',
                    type_str: typeStr,
                    data: { player_id: 'audio_1', state: 'play' },
                },
            });
            expect(msg).toEqual({
                kind: 'unknown_event',
                typeStr,
                data: { player_id: 'audio_1', state: 'play' },
            });
        },
    );

    // A player's own io_changed frames — the raw command echo and the
    // on<state> mirrors — must still decode as ordinary io_changed.
    it.each([['volume set 55'], ['onplay'], ['onsongchange'], ['onvolumechange']])(
        'decodes a player io_changed carrying state %o',
        (state) => {
            expect(
                decodeServerMessage({
                    msg: 'event',
                    data: { type_str: 'io_changed', data: { id: 'audio_1', state } },
                }),
            ).toEqual({ kind: 'io_changed', id: 'audio_1', state });
        },
    );
});
