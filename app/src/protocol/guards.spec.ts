import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    toAudioPlayerItem,
    toCameraItem,
    toHomeData,
    toIoItem,
    toIoStatusInfo,
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

describe('toIoStatusInfo', () => {
    it('is null for an IO that reports nothing — which is most of them', () => {
        expect(toIoStatusInfo(undefined)).toBeNull();
        expect(toIoStatusInfo(null)).toBeNull();
        expect(toIoStatusInfo('nonsense')).toBeNull();
        expect(toIoStatusInfo([])).toBeNull();
    });

    it('treats an empty status_info as "this is a device", as calaos_mobile does', () => {
        // The reference client sets hasStatusInfo on any status_info at all.
        expect(toIoStatusInfo({})).toEqual({
            batteryLevel: null,
            wirelessSignal: null,
            connected: null,
            uptime: null,
            ipAddress: '',
            wifiSsid: '',
        });
    });

    it('reads every field calaos_mobile reads, in the wire spelling', () => {
        expect(
            toIoStatusInfo({
                battery_level: '85',
                wireless_signal: '60',
                connected: 'false',
                uptime: '123456',
                ip_address: '192.168.1.42',
                wifi_ssid: 'maison',
            }),
        ).toEqual({
            batteryLevel: 85,
            wirelessSignal: 60,
            connected: false,
            uptime: 123456,
            ipAddress: '192.168.1.42',
            wifiSsid: 'maison',
        });
    });

    it('keeps a missing level missing rather than calling it zero', () => {
        // A defaulted 0 would render as a flat battery, blinking, on every
        // mains-powered device in the house.
        const status = toIoStatusInfo({ wireless_signal: '50' });

        expect(status?.batteryLevel).toBeNull();
        expect(status?.wirelessSignal).toBe(50);
    });

    it('drops a level it cannot read rather than guessing', () => {
        expect(toIoStatusInfo({ battery_level: 'unknown' })?.batteryLevel).toBeNull();
    });
});

describe('toIoItem', () => {
    it('converts a full wire IO, turning visible/rw strings into booleans', () => {
        expect(
            toIoItem({
                id: 'io_12',
                name: 'Lampe salon',
                gui_type: 'light',
                io_style: 'outlet',
                state: 'true',
                visible: 'true',
                rw: 'false',
                unit: '',
            }),
        ).toEqual({
            id: 'io_12',
            name: 'Lampe salon',
            guiType: 'light',
            ioStyle: 'outlet',
            state: 'true',
            visible: true,
            rw: false,
            unit: '',
            status: null,
        });
    });

    it('carries status_info through when the device reports any', () => {
        const io = toIoItem({
            id: 'io_13',
            gui_type: 'light',
            status_info: { battery_level: '42', connected: 'true', wireless_signal: '80' },
        });

        expect(io.status).toEqual({
            batteryLevel: 42,
            wirelessSignal: 80,
            connected: true,
            uptime: null,
            ipAddress: '',
            wifiSsid: '',
        });
    });

    it('reads io_style, the key the server actually sends, before gui_style', () => {
        // calaos_server's parameter whitelist (`JsonApi::buildJsonIO`) carries
        // `io_style` and NOT `gui_style`, so the old field never arrived and
        // every styled IO fell back to the default glyph. `gui_style` stays
        // supported as a fallback: it is what the AngularJS templates read.
        expect(toIoItem({ io_style: 'pump', gui_style: 'heater' }).ioStyle).toBe('pump');
        expect(toIoItem({ gui_style: 'heater' }).ioStyle).toBe('heater');
        expect(toIoItem({}).ioStyle).toBe('');
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
    });

    // buildJsonAudio's full entry: capability flags in the 'true'/'false' wire
    // spelling, and `avr` present only when the player has a linked receiver.
    it('converts a player entry, capability flags included', () => {
        expect(
            toAudioPlayerItem({
                id: '3',
                name: 'Squeezebox',
                type: 'slim',
                playlist: 'true',
                database: 'false',
                avr: 'avr_1',
            }),
        ).toEqual({
            id: '3',
            name: 'Squeezebox',
            type: 'slim',
            canPlaylist: true,
            canDatabase: false,
            avr: 'avr_1',
        });
    });

    it('leaves avr empty for a player with no receiver', () => {
        expect(toAudioPlayerItem({ id: '3', name: 'Salon' }).avr).toBe('');
    });

    it.each(GARBAGE.map((g) => [g]))('never throws on garbage input %o', (garbage) => {
        expect(toCameraItem(garbage)).toEqual({ id: '', name: '' });
        // Capability flags default to false: only the exact string 'true'
        // enables anything, exactly as visible/rw behave.
        expect(toAudioPlayerItem(garbage)).toEqual({
            id: '',
            name: '',
            type: '',
            canPlaylist: false,
            canDatabase: false,
            avr: '',
        });
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
            audio: [{ id: '1', name: 'Player', type: 'slim', playlist: 'true', database: 'true' }],
        });
        expect(home.rooms.map((r) => r.name)).toEqual(['B', 'A']);
        expect(home.cameras).toEqual([{ id: '0', name: 'Cam' }]);
        expect(home.audio).toEqual([
            {
                id: '1',
                name: 'Player',
                type: 'slim',
                canPlaylist: true,
                canDatabase: true,
                avr: '',
            },
        ]);
    });

    it('turns missing home/cameras/audio arrays into []', () => {
        expect(toHomeData({})).toEqual({ rooms: [], cameras: [], audio: [] });
    });

    it.each(GARBAGE.map((g) => [g]))('never throws on garbage input %o', (garbage) => {
        expect(() => toHomeData(garbage)).not.toThrow();
        expect(toHomeData(garbage)).toEqual({ rooms: [], cameras: [], audio: [] });
    });
});
