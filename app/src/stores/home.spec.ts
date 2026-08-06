import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { PENDING_TIMEOUT_MS, useHomeStore } from './home';
import { toHomeData } from '../protocol/guards';
import type { HomeData } from '../protocol/types';

// Fixtures are built from WIRE shapes through the real guards, so these specs
// exercise exactly what services/calaos.ts hands to setHome().
function wireIo(
    id: string,
    guiType: string,
    extra: Record<string, string> = {},
): Record<string, string> {
    return {
        id,
        name: id,
        gui_type: guiType,
        state: '',
        visible: 'true',
        rw: 'true',
        unit: '',
        ...extra,
    };
}

function homeFixture(): HomeData {
    return toHomeData({
        home: [
            {
                name: 'Salon',
                type: 'lounge',
                hits: '12',
                items: [
                    wireIo('light_1', 'light', { state: 'false' }),
                    wireIo('temp_1', 'temp', { state: '21.5' }),
                    // Second temp of the room — must NOT win over temp_1.
                    wireIo('temp_2', 'temp', { state: '19' }),
                ],
            },
            {
                name: 'Cuisine',
                type: 'kitchen',
                hits: '47',
                items: [wireIo('light_2', 'light', { state: 'true' })],
            },
            { name: 'Cave', type: 'cellar', hits: '3', items: [] },
        ],
        cameras: [
            { id: 'camera_1', name: 'Entrée' },
            { id: 'camera_2', name: 'Jardin' },
        ],
        audio: [{ id: 'audio_1', name: 'Salon' }],
    });
}

let sent: string[];

function attachOkTransport(): void {
    const store = useHomeStore();
    store.attachTransport((frame) => {
        sent.push(frame);
        return true;
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    sent = [];
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('get_home normalization', () => {
    it('sorts rooms by hits desc and uses the sorted index as roomId', () => {
        const store = useHomeStore();
        store.setHome(homeFixture());

        expect(store.rooms.map((room) => room.name)).toEqual(['Cuisine', 'Salon', 'Cave']);
        expect(store.rooms.map((room) => room.roomId)).toEqual([0, 1, 2]);
        expect(store.rooms.map((room) => room.hits)).toEqual([47, 12, 3]);
        expect(store.roomCount).toBe(3);
        expect(store.loaded).toBe(true);
    });

    it('keeps the wire order of rooms with equal hits (stable sort)', () => {
        const store = useHomeStore();
        store.setHome(
            toHomeData({
                home: [
                    { name: 'A', type: 'other', hits: '5', items: [] },
                    { name: 'B', type: 'other', hits: '5', items: [] },
                    { name: 'C', type: 'other', hits: '5', items: [] },
                ],
            }),
        );

        expect(store.rooms.map((room) => room.name)).toEqual(['A', 'B', 'C']);
    });

    it('makes `ios` the single source of truth, referenced by room ioIds', () => {
        const store = useHomeStore();
        store.setHome(homeFixture());

        expect([...store.ios.keys()].sort()).toEqual(['light_1', 'light_2', 'temp_1', 'temp_2']);
        expect(store.rooms[0]?.ioIds).toEqual(['light_2']);
        expect(store.rooms[1]?.ioIds).toEqual(['light_1', 'temp_1', 'temp_2']);
        expect(store.rooms[2]?.ioIds).toEqual([]);
        // Rooms carry ids only — no second copy of the IO objects.
        expect(store.rooms[1]).not.toHaveProperty('items');
        expect(store.getIo('temp_1')?.state).toBe('21.5');
        expect(store.getIo('nope')).toBeUndefined();
    });

    it('keeps the same Map instance across ingests (components may hold it)', () => {
        const store = useHomeStore();
        store.setHome(homeFixture());
        const map = store.ios;

        store.setHome(
            toHomeData({
                home: [
                    {
                        name: 'Only',
                        type: 'other',
                        hits: '1',
                        items: [wireIo('light_9', 'light')],
                    },
                ],
            }),
        );

        expect(store.ios).toBe(map);
        // …and the previous session's IOs are gone, not merged in.
        expect([...store.ios.keys()]).toEqual(['light_9']);
    });

    it('records the FIRST temp IO of each room as tempIoId', () => {
        const store = useHomeStore();
        store.setHome(homeFixture());

        expect(store.rooms[1]?.tempIoId).toBe('temp_1');
        // Rooms without a temp IO.
        expect(store.rooms[0]?.tempIoId).toBeNull();
        expect(store.rooms[2]?.tempIoId).toBeNull();
    });

    it('indexes cameras and audio players', () => {
        const store = useHomeStore();
        store.setHome(homeFixture());

        expect(store.cameras).toEqual([
            { cameraId: 0, id: 'camera_1', name: 'Entrée' },
            { cameraId: 1, id: 'camera_2', name: 'Jardin' },
        ]);
        expect(store.audioPlayers).toEqual([
            {
                playerId: 0,
                id: 'audio_1',
                name: 'Salon',
                type: '',
                canPlaylist: false,
                canDatabase: false,
                avr: '',
            },
        ]);
        expect(store.cameraCount).toBe(2);
        expect(store.audioPlayerCount).toBe(1);
    });

    it('survives an empty house', () => {
        const store = useHomeStore();
        store.setHome(toHomeData({}));

        expect(store.rooms).toEqual([]);
        expect(store.ios.size).toBe(0);
        expect(store.cameras).toEqual([]);
        expect(store.audioPlayers).toEqual([]);
        expect(store.loaded).toBe(true);
    });
});

describe('handleEvent — io_changed', () => {
    it('patches the state in place', () => {
        const store = useHomeStore();
        store.setHome(homeFixture());

        store.handleEvent({ kind: 'io_changed', id: 'light_1', state: 'true' });

        expect(store.getIo('light_1')?.state).toBe('true');
        expect(store.getIo('light_1')?.name).toBe('light_1');
    });

    it('patches the name only when the event carried one', () => {
        const store = useHomeStore();
        store.setHome(homeFixture());

        store.handleEvent({ kind: 'io_changed', id: 'light_1', name: 'Plafonnier' });
        expect(store.getIo('light_1')?.name).toBe('Plafonnier');
        // state untouched by a name-only event
        expect(store.getIo('light_1')?.state).toBe('false');

        store.handleEvent({ kind: 'io_changed', id: 'light_1', state: 'true', name: 'Lustre' });
        expect(store.getIo('light_1')).toMatchObject({ state: 'true', name: 'Lustre' });
    });

    it('leaves everything alone for an id-only event', () => {
        const store = useHomeStore();
        store.setHome(homeFixture());

        store.handleEvent({ kind: 'io_changed', id: 'light_1' });

        expect(store.getIo('light_1')).toMatchObject({ state: 'false', name: 'light_1' });
    });

    it('logs (never throws) for an unknown IO id', () => {
        const store = useHomeStore();
        store.setHome(homeFixture());

        expect(() =>
            store.handleEvent({ kind: 'io_changed', id: 'ghost', state: 'true' }),
        ).not.toThrow();
        expect(console.debug).toHaveBeenCalledWith(
            'calaos home: io_changed for an unknown IO',
            'ghost',
        );
        expect(store.ios.has('ghost')).toBe(false);
    });
});

describe('handleEvent — dispatch table stubs', () => {
    // The audio types are NOT in this list any more: T16 found the old TODO's
    // `audio_status`/`audio_volume`/`audio_songchanged` never existed under
    // those names upstream, and T17 implemented the real ones — see the
    // "audio events" suite below.
    it.each([
        'new_io',
        'delete_io',
        'new_room',
        'modify_room',
        'delete_room',
    ])('stubs the documented event type %s', (typeStr) => {
        const store = useHomeStore();
        store.setHome(homeFixture());

        expect(() =>
            store.handleEvent({ kind: 'unknown_event', typeStr, data: { id: 'x' } }),
        ).not.toThrow();
        expect(console.debug).toHaveBeenCalledWith(
            `calaos home: event "${typeStr}" not implemented yet`,
            { id: 'x' },
        );
        // No stub touches the model.
        expect(store.rooms).toHaveLength(3);
        expect(store.ios.size).toBe(4);
    });

    it('falls back to the same stub for an event type nobody listed', () => {
        const store = useHomeStore();

        expect(() =>
            store.handleEvent({ kind: 'unknown_event', typeStr: 'quantum_flux', data: undefined }),
        ).not.toThrow();
        expect(console.debug).toHaveBeenCalledWith(
            'calaos home: event "quantum_flux" not implemented yet',
            undefined,
        );
    });
});

describe('handleEvent — audio events', () => {
    // T16 corrected all three names off EventManager.h; the old app's TODO
    // spelled them audio_status / audio_volume / audio songchanged, which
    // never existed in any released calaos_base source.
    const AUDIO_EVENTS = ['audio_status_changed', 'audio_volume_changed', 'audio_song_changed'];

    it.each(AUDIO_EVENTS)('forwards %s to the attached audio handler, untouched', (typeStr) => {
        const store = useHomeStore();
        const handler = vi.fn();
        store.attachAudioEvents(handler);

        store.handleEvent({
            kind: 'unknown_event',
            typeStr,
            data: { player_id: 'audio_1', state: 'play' },
        });

        expect(handler).toHaveBeenCalledWith(typeStr, { player_id: 'audio_1', state: 'play' });
    });

    it.each(AUDIO_EVENTS)('says so rather than throwing when %s arrives unattached', (typeStr) => {
        const store = useHomeStore();

        expect(() =>
            store.handleEvent({ kind: 'unknown_event', typeStr, data: { player_id: 'audio_1' } }),
        ).not.toThrow();
        expect(console.debug).toHaveBeenCalledWith(
            `calaos home: audio event "${typeStr}" with no audio store attached`,
            { player_id: 'audio_1' },
        );
    });

    it('routes a handler attached after the fact', () => {
        const store = useHomeStore();
        const handler = vi.fn();

        store.handleEvent({ kind: 'unknown_event', typeStr: 'audio_song_changed', data: {} });
        store.attachAudioEvents(handler);
        store.handleEvent({ kind: 'unknown_event', typeStr: 'audio_song_changed', data: {} });

        expect(handler).toHaveBeenCalledTimes(1);
    });

    // A player emits io_changed too — the raw command echo and the on<state>
    // mirrors. They are ordinary io_changed frames and must stay that way:
    // forwarding them as well would apply every change twice.
    it.each([['volume set 55'], ['onplay'], ['onpause'], ['onsongchange']])(
        'does not forward a player io_changed carrying state %o',
        (state) => {
            const store = useHomeStore();
            const handler = vi.fn();
            store.attachAudioEvents(handler);

            expect(() =>
                store.handleEvent({ kind: 'io_changed', id: 'audio_1', state }),
            ).not.toThrow();
            expect(handler).not.toHaveBeenCalled();
        },
    );

    // A player configured inside a room IS serialised into that room's items
    // (buildJsonRoomIO filters nothing), with visible:"false" so nothing
    // renders it. Its echoes land on it like any other io state.
    it('patches a player that happens to sit in a room, without complaint', () => {
        const store = useHomeStore();
        store.setHome(
            toHomeData({
                home: [
                    {
                        name: 'Salon',
                        hits: '1',
                        items: [
                            {
                                id: 'audio_1',
                                name: 'Salon',
                                gui_type: 'audio_player',
                                visible: 'false',
                                state: '',
                            },
                        ],
                    },
                ],
                cameras: [],
                audio: [],
            }),
        );

        store.handleEvent({ kind: 'io_changed', id: 'audio_1', state: 'onplay' });
        expect(store.getIo('audio_1')?.state).toBe('onplay');
        // gui_type audio_player is not one of the 14 the room grid renders.
        expect(store.getIo('audio_1')?.guiType).toBe('unknown');
    });
});

describe('set_state pending lifecycle', () => {
    it('sends the exact frame and records the pending value', () => {
        vi.setSystemTime(new Date('2026-01-02T03:04:05Z'));
        const store = useHomeStore();
        attachOkTransport();
        store.setHome(homeFixture());

        expect(store.sendSetState('light_1', 'true')).toBe(true);
        expect(sent).toEqual(['{"msg":"set_state","data":{"id":"light_1","value":"true"}}']);
        expect(store.pending.get('light_1')).toEqual({ value: 'true', sentAt: Date.now() });
        expect(store.isPending('light_1')).toBe(true);
        expect(store.isPending('light_2')).toBe(false);
    });

    it('records nothing when the frame could not be sent', () => {
        const store = useHomeStore();
        store.attachTransport(() => false);
        store.setHome(homeFixture());

        expect(store.sendSetState('light_1', 'true')).toBe(false);
        expect(store.pending.size).toBe(0);
    });

    it('warns and reports failure when no transport is attached', () => {
        const store = useHomeStore();
        store.setHome(homeFixture());

        expect(store.sendSetState('light_1', 'true')).toBe(false);
        expect(console.warn).toHaveBeenCalled();
        expect(store.pending.size).toBe(0);
    });

    it('is cleared by the io_changed for that IO only', () => {
        const store = useHomeStore();
        attachOkTransport();
        store.setHome(homeFixture());

        store.sendSetState('light_1', 'true');
        store.sendSetState('light_2', 'false');

        store.handleEvent({ kind: 'io_changed', id: 'light_1', state: 'true' });

        expect(store.isPending('light_1')).toBe(false);
        expect(store.isPending('light_2')).toBe(true);
    });

    it('is cleared silently 5 s after the send', () => {
        const store = useHomeStore();
        attachOkTransport();
        store.setHome(homeFixture());
        store.sendSetState('light_1', 'true');

        vi.advanceTimersByTime(PENDING_TIMEOUT_MS - 1);
        expect(store.isPending('light_1')).toBe(true);

        vi.advanceTimersByTime(1);
        expect(store.isPending('light_1')).toBe(false);
        expect(store.pending.size).toBe(0);
        // Silently: no warn/error, and the IO state is left as the server has it.
        expect(console.warn).not.toHaveBeenCalled();
        expect(store.getIo('light_1')?.state).toBe('false');
    });

    it('does not let a cleared timeout kill a later pending for the same IO', () => {
        const store = useHomeStore();
        attachOkTransport();
        store.setHome(homeFixture());

        store.sendSetState('light_1', 'true');
        vi.advanceTimersByTime(4000);
        store.handleEvent({ kind: 'io_changed', id: 'light_1', state: 'true' });

        store.sendSetState('light_1', 'false');
        // The first send's 5 s deadline elapses here — it must be disarmed.
        vi.advanceTimersByTime(1000);
        expect(store.isPending('light_1')).toBe(true);

        vi.advanceTimersByTime(PENDING_TIMEOUT_MS - 1000);
        expect(store.isPending('light_1')).toBe(false);
    });

    it('restarts the deadline when the same IO is set again', () => {
        const store = useHomeStore();
        attachOkTransport();
        store.setHome(homeFixture());

        store.sendSetState('light_1', 'true');
        vi.advanceTimersByTime(4000);
        store.sendSetState('light_1', 'false');
        expect(store.pending.get('light_1')?.value).toBe('false');

        vi.advanceTimersByTime(4999);
        expect(store.isPending('light_1')).toBe(true);
        vi.advanceTimersByTime(1);
        expect(store.isPending('light_1')).toBe(false);
    });
});

describe('clear', () => {
    it('empties the whole model, ios Map included, and disarms pending timers', () => {
        const store = useHomeStore();
        attachOkTransport();
        store.setHome(homeFixture());
        store.sendSetState('light_1', 'true');
        const map = store.ios;

        store.clear();

        expect(store.rooms).toEqual([]);
        expect(store.cameras).toEqual([]);
        expect(store.audioPlayers).toEqual([]);
        expect(store.ios.size).toBe(0);
        expect(store.ios).toBe(map);
        expect(store.pending.size).toBe(0);
        expect(store.loaded).toBe(false);

        // The old ioCache survived signOut and kept absorbing events.
        expect(() =>
            store.handleEvent({ kind: 'io_changed', id: 'light_1', state: 'true' }),
        ).not.toThrow();
        expect(store.getIo('light_1')).toBeUndefined();

        vi.advanceTimersByTime(10 * PENDING_TIMEOUT_MS);
        expect(store.pending.size).toBe(0);
    });

    it('drops pending entries on a fresh get_home too', () => {
        const store = useHomeStore();
        attachOkTransport();
        store.setHome(homeFixture());
        store.sendSetState('light_1', 'true');

        store.setHome(homeFixture());

        expect(store.pending.size).toBe(0);
    });
});
