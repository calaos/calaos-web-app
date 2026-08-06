import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeServerMessage, encodeGetHome, encodeLogin, encodeSetState } from './messages';
import { setColor, setPercent, setText } from './io-states';

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
                                guiStyle: '',
                                state: 'false',
                                visible: true,
                                rw: true,
                                unit: '',
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
