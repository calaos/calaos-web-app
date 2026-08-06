import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    toAudioPlayerItem,
    toCameraItem,
    toHomeData,
    toIoItem,
    toRoom,
    toWireString,
    wireBool,
} from './guards';
import { GUI_TYPES } from './types';

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

// Fuzz corpus: none of these may ever make a guard throw.
const GARBAGE: unknown[] = [
    null,
    undefined,
    42,
    3.14,
    NaN,
    true,
    false,
    'a string',
    '',
    [],
    [1, 2, 3],
    {},
    { random: 'junk' },
    () => 'nope',
    Symbol('bad'),
];

describe('wireBool', () => {
    it.each([
        ['true', true],
        [true, true],
        ['false', false],
        [false, false],
        ['TRUE', false],
        ['1', false],
        ['', false],
        [undefined, false],
        [null, false],
        [1, false],
    ])('%o → %s (only the string "true" — or a real boolean true — is truthy)', (input, expected) => {
        expect(wireBool(input)).toBe(expected);
    });
});

describe('toWireString', () => {
    it.each([
        ['hello', 'hello'],
        ['', ''],
        [42, '42'],
        [true, 'true'],
        [false, 'false'],
        [null, ''],
        [undefined, ''],
        [{}, ''],
        [[], ''],
    ])('%o → %o', (input, expected) => {
        expect(toWireString(input)).toBe(expected);
    });
});

describe('toIoItem', () => {
    it('converts a full wire IO, turning visible/rw strings into booleans', () => {
        expect(
            toIoItem({
                id: 'io_12',
                name: 'Lampe salon',
                gui_type: 'light',
                gui_style: 'light_on',
                state: 'true',
                visible: 'true',
                rw: 'false',
                unit: '',
            }),
        ).toEqual({
            id: 'io_12',
            name: 'Lampe salon',
            guiType: 'light',
            guiStyle: 'light_on',
            state: 'true',
            visible: true,
            rw: false,
            unit: '',
        });
    });

    it.each(GUI_TYPES.map((t) => [t]))('maps gui_type %o to its own discriminant', (guiType) => {
        const io = toIoItem({ id: '1', gui_type: guiType, state: '', visible: 'true', rw: 'true' });
        expect(io.guiType).toBe(guiType);
    });

    it('falls back to guiType "unknown" and keeps the raw gui_type string', () => {
        const io = toIoItem({ id: '1', gui_type: 'timer', state: '0' });
        expect(io.guiType).toBe('unknown');
        expect(io).toHaveProperty('rawGuiType', 'timer');
    });

    it('treats a missing gui_type as unknown with an empty rawGuiType', () => {
        const io = toIoItem({ id: '1' });
        expect(io.guiType).toBe('unknown');
        expect(io).toHaveProperty('rawGuiType', '');
    });

    it('defaults missing visible/rw to false (old app only rendered on the exact string "true")', () => {
        const io = toIoItem({ id: '1', gui_type: 'light', state: 'true' });
        expect(io.visible).toBe(false);
        expect(io.rw).toBe(false);
    });

    it('coerces numeric wire values to strings', () => {
        const io = toIoItem({ id: 7, name: 8, gui_type: 'var_int', state: 42, unit: 0 });
        expect(io.id).toBe('7');
        expect(io.name).toBe('8');
        expect(io.state).toBe('42');
        expect(io.unit).toBe('0');
    });

    it.each(GARBAGE.map((g) => [g]))('never throws on garbage input %o', (garbage) => {
        expect(() => toIoItem(garbage)).not.toThrow();
        const io = toIoItem(garbage);
        expect(io.guiType).toBe('unknown');
        expect(io.id).toBe('');
        expect(io.state).toBe('');
        expect(io.visible).toBe(false);
        expect(io.rw).toBe(false);
    });

    it('warns (but does not throw) on a non-object frame', () => {
        toIoItem(null);
        expect(console.warn).toHaveBeenCalled();
    });
});

describe('toRoom', () => {
    it('converts a full wire room, hits string → number', () => {
        const room = toRoom({
            name: 'Salon',
            type: 'lounge',
            hits: '12',
            items: [{ id: '1', gui_type: 'temp', state: '21', visible: 'true', rw: 'false' }],
        });
        expect(room.name).toBe('Salon');
        expect(room.type).toBe('lounge');
        expect(room.hits).toBe(12);
        expect(room.items).toHaveLength(1);
        expect(room.items[0].guiType).toBe('temp');
    });

    it.each([
        ['0', 0],
        ['42', 42],
        [undefined, 0],
        ['not a number', 0],
        ['', 0],
        [7, 7],
    ])('hits %o → %d (NaN → 0 so a bad value cannot poison the sort)', (hits, expected) => {
        expect(toRoom({ name: 'r', type: 't', hits, items: [] }).hits).toBe(expected);
    });

    it('turns a missing or non-array items into []', () => {
        expect(toRoom({ name: 'r', type: 't', hits: '0' }).items).toEqual([]);
        expect(toRoom({ name: 'r', type: 't', hits: '0', items: 'nope' }).items).toEqual([]);
    });

    it.each(GARBAGE.map((g) => [g]))('never throws on garbage input %o', (garbage) => {
        expect(() => toRoom(garbage)).not.toThrow();
        expect(toRoom(garbage)).toEqual({ name: '', type: '', hits: 0, items: [] });
    });
});

describe('toCameraItem / toAudioPlayerItem', () => {
    it('converts id and name', () => {
        expect(toCameraItem({ id: '0', name: 'Entrée' })).toEqual({ id: '0', name: 'Entrée' });
        expect(toAudioPlayerItem({ id: '3', name: 'Squeezebox' })).toEqual({ id: '3', name: 'Squeezebox' });
    });

    it.each(GARBAGE.map((g) => [g]))('never throws on garbage input %o', (garbage) => {
        expect(toCameraItem(garbage)).toEqual({ id: '', name: '' });
        expect(toAudioPlayerItem(garbage)).toEqual({ id: '', name: '' });
    });
});

describe('toHomeData', () => {
    it('converts the full get_home payload and preserves wire room order (sorting is the store\'s job)', () => {
        const home = toHomeData({
            home: [
                { name: 'B', type: 'bedroom', hits: '1', items: [] },
                { name: 'A', type: 'lounge', hits: '9', items: [] },
            ],
            cameras: [{ id: '0', name: 'Cam' }],
            audio: [{ id: '1', name: 'Player' }],
        });
        expect(home.rooms.map((r) => r.name)).toEqual(['B', 'A']);
        expect(home.cameras).toEqual([{ id: '0', name: 'Cam' }]);
        expect(home.audio).toEqual([{ id: '1', name: 'Player' }]);
    });

    it('turns missing home/cameras/audio arrays into []', () => {
        expect(toHomeData({})).toEqual({ rooms: [], cameras: [], audio: [] });
    });

    it.each(GARBAGE.map((g) => [g]))('never throws on garbage input %o', (garbage) => {
        expect(() => toHomeData(garbage)).not.toThrow();
        expect(toHomeData(garbage)).toEqual({ rooms: [], cameras: [], audio: [] });
    });
});
