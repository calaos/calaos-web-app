// Home store — the normalized house model plus the set_state pending
// bookkeeping.
//
// Normalization (docs/ARCHITECTURE.md "Stores"): rooms are sorted desc by
// `hits` at ingest and their index becomes `roomId` (same as the old app, and
// the router's /home/:roomId param), but the IO objects themselves live ONLY
// in the `ios` Map — rooms reference `ioIds`. The old app kept every IO in
// two places (inside homeData.home[i].items AND in the `ioCache` array) and
// relied on them being the same object identity.
//
// Fixes carried here:
//  - `clear()` really empties everything, `ios` included; the old signOut set
//    homeData = '' but left ioCache populated, so the next session's
//    io_changed events patched the previous user's IO objects.
//  - `handleEvent` is a dispatch table: the unimplemented event types are
//    explicit entries instead of an else-branch, so adding one is one line.

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { encodeSetState } from '../protocol/messages';
import type {
    AudioPlayerItem,
    CameraItem,
    HomeData,
    IoChangedMessage,
    IoItem,
    UnknownEventMessage,
} from '../protocol/types';

/** A set_state with no io_changed answer is forgotten (silently) after this. */
export const PENDING_TIMEOUT_MS = 5000;

/**
 * Sends a pre-encoded frame; false when the socket is not open (the frame is
 * dropped, never queued). Attached by services/calaos.ts. Declared locally
 * rather than imported from another store to keep the store modules free of
 * cross-imports.
 */
export type FrameSender = (frame: string) => boolean;

export interface RoomVM {
    /** Index in the hits-sorted room list — the /home/:roomId route param. */
    roomId: number;
    name: string;
    type: string;
    hits: number;
    /** Keys into `ios`, in wire order (visible/rw gating happens at render). */
    ioIds: string[];
    /** First `temp` IO of the room, shown on the room tile; null when none. */
    tempIoId: string | null;
}

export interface CameraVM extends CameraItem {
    /** Index — the /security/:cameraId route param. */
    cameraId: number;
}

export interface AudioPlayerVM extends AudioPlayerItem {
    /** Index — the /audio/:playerId route param. */
    playerId: number;
}

export interface PendingSetState {
    /** The wire value that was sent ('true', 'set 42', raw text, …). */
    value: string;
    /** Date.now() at send time — lets the UI age the indicator if it wants. */
    sentAt: number;
}

/** The event frames the home store understands (see protocol/messages.ts). */
export type HomeEvent = IoChangedMessage | UnknownEventMessage;

type EventHandler = (typeStr: string, data: unknown) => void;

// Known-but-unimplemented event types. Same body for every entry today; the
// point of the table is that implementing one is a single line, and that an
// unrecognized type_str logs instead of throwing.
const notImplemented: EventHandler = (typeStr, data) => {
    console.debug(`calaos home: event "${typeStr}" not implemented yet`, data);
};

const NOT_IMPLEMENTED_EVENTS: Record<string, EventHandler> = {
    new_io: notImplemented,
    delete_io: notImplemented,
    new_room: notImplemented,
    modify_room: notImplemented,
    delete_room: notImplemented,
};

/**
 * The three audio event types, spelled the way calaos_server actually spells
 * them (docs/audio-protocol.md "Events"). The old app's TODO listed
 * `audio_status` / `audio_volume` / `audio songchanged`, which never existed
 * under those names in any released source — T16 read them off
 * `EventManager.h` and corrected all three.
 *
 * They are forwarded, not handled: the state they describe lives in
 * stores/audio.ts (see its header for why it is a store of its own), and the
 * handler is injected rather than imported so the two store modules stay free
 * of cross-imports — the same arrangement `attachTransport` uses for the socket.
 */
export const AUDIO_EVENT_TYPES = [
    'audio_status_changed',
    'audio_volume_changed',
    'audio_song_changed',
] as const;

export const useHomeStore = defineStore('home', () => {
    const rooms = ref<RoomVM[]>([]);
    // Single source of truth for IO objects. The Map instance is created once
    // and only ever cleared/refilled, so components may hold a reference to it.
    const ios = ref(new Map<string, IoItem>());
    const cameras = ref<CameraVM[]>([]);
    const audioPlayers = ref<AudioPlayerVM[]>([]);
    const pending = ref(new Map<string, PendingSetState>());
    /** True once a get_home has been ingested (false again after clear()). */
    const loaded = ref(false);

    // Not state: timer handles, and the socket sender injected by the service.
    const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
    let send: FrameSender = (frame) => {
        console.warn('calaos home: no transport attached, dropping frame:', frame);
        return false;
    };
    let audioEvents: EventHandler = (typeStr, data) => {
        console.debug(`calaos home: audio event "${typeStr}" with no audio store attached`, data);
    };

    const eventHandlers: Record<string, EventHandler> = { ...NOT_IMPLEMENTED_EVENTS };
    for (const typeStr of AUDIO_EVENT_TYPES) {
        // Read through the slot at call time, not at build time, so attaching
        // the audio store later still routes every entry.
        eventHandlers[typeStr] = (type, data) => audioEvents(type, data);
    }

    const roomCount = computed(() => rooms.value.length);
    const cameraCount = computed(() => cameras.value.length);
    const audioPlayerCount = computed(() => audioPlayers.value.length);

    /** Called once by services/calaos.ts with the socket's send(). */
    function attachTransport(sender: FrameSender): void {
        send = sender;
    }

    /** Called once by services/calaos.ts with the audio store's event handler. */
    function attachAudioEvents(handler: EventHandler): void {
        audioEvents = handler;
    }

    function getIo(id: string): IoItem | undefined {
        return ios.value.get(id);
    }

    function getRoom(roomId: number): RoomVM | undefined {
        return rooms.value[roomId];
    }

    function isPending(id: string): boolean {
        return pending.value.has(id);
    }

    // -----------------------------------------------------------------------
    // get_home ingest
    // -----------------------------------------------------------------------

    function setHome(home: HomeData): void {
        // Sort a copy: guards.ts hands out a fresh array, but the caller's
        // data should never be mutated behind its back. Array#sort is stable
        // (ES2019+), so rooms with equal hits keep their wire order — the old
        // in-place sort behaved the same way.
        const sorted = [...home.rooms].sort((a, b) => b.hits - a.hits);

        clearPendingAll();
        ios.value.clear();

        rooms.value = sorted.map((room, index) => {
            const ioIds: string[] = [];
            let tempIoId: string | null = null;
            for (const item of room.items) {
                ios.value.set(item.id, item);
                ioIds.push(item.id);
                // First temp IO wins (old: `!homeData.home[i].hasTemp`).
                if (tempIoId === null && item.guiType === 'temp') tempIoId = item.id;
            }
            const { name, type, hits } = room;
            return { roomId: index, name, type, hits, ioIds, tempIoId };
        });

        cameras.value = home.cameras.map((camera, index) => ({ ...camera, cameraId: index }));
        audioPlayers.value = home.audio.map((player, index) => ({ ...player, playerId: index }));
        loaded.value = true;
    }

    // -----------------------------------------------------------------------
    // events
    // -----------------------------------------------------------------------

    /**
     * Audio players emit `io_changed` too — the raw command echo
     * (`state:"volume set 55"`) and the `onplay`/`onpause`/`onsongchange`
     * mirrors of their internal status (docs/audio-protocol.md "Events").
     * They land here like any other io_changed and are handled the ordinary
     * way: patch the io if the house happens to contain it (a player
     * configured inside a room is serialised into that room's items with
     * `visible:"false"`, so it is never rendered), log and move on if not.
     *
     * They are deliberately NOT forwarded to the audio store: the same change
     * always arrives there as a typed `audio_*` event, and acting on both
     * would apply it twice.
     */
    function applyIoChanged(msg: IoChangedMessage): void {
        // The answer landed (or the IO changed for another reason) — either
        // way the indicator has served its purpose.
        clearPending(msg.id);

        const io = ios.value.get(msg.id);
        if (io === undefined) {
            // Old code: the hasOwnProperty(ioCache) miss fell into the
            // "Event not implemented!" debug branch. Same non-event here.
            console.debug('calaos home: io_changed for an unknown IO', msg.id);
            return;
        }
        // Patch semantics: absent keys leave the current value alone (old
        // code checked hasOwnProperty before assigning).
        if (msg.state !== undefined) io.state = msg.state;
        if (msg.name !== undefined) io.name = msg.name;
    }

    /** Dispatch table entry point. NEVER throws on an unknown event. */
    function handleEvent(msg: HomeEvent): void {
        if (msg.kind === 'io_changed') {
            applyIoChanged(msg);
            return;
        }
        const handler = eventHandlers[msg.typeStr] ?? notImplemented;
        handler(msg.typeStr, msg.data);
    }

    // -----------------------------------------------------------------------
    // set_state + pending lifecycle
    // -----------------------------------------------------------------------

    function clearPending(id: string): void {
        const timer = pendingTimers.get(id);
        if (timer !== undefined) {
            clearTimeout(timer);
            pendingTimers.delete(id);
        }
        pending.value.delete(id);
    }

    function clearPendingAll(): void {
        for (const timer of pendingTimers.values()) clearTimeout(timer);
        pendingTimers.clear();
        pending.value.clear();
    }

    /**
     * Sends a set_state and marks the IO pending. NOT optimistic: the state
     * shown keeps coming from the server, because many IOs answer with
     * something other than the value that was sent ('set 50' → '50', a
     * shutter → 'up 30'…). Returns false when the frame was dropped (socket
     * not open) — nothing is marked pending in that case, since no answer is
     * coming.
     */
    function sendSetState(id: string, value: string): boolean {
        if (!send(encodeSetState(id, value))) return false;

        clearPending(id);
        pending.value.set(id, { value, sentAt: Date.now() });
        pendingTimers.set(
            id,
            setTimeout(() => {
                // Silent: a missing answer is not worth an error toast, the
                // real state is whatever the server keeps telling us.
                pendingTimers.delete(id);
                pending.value.delete(id);
            }, PENDING_TIMEOUT_MS),
        );
        return true;
    }

    // -----------------------------------------------------------------------
    // teardown
    // -----------------------------------------------------------------------

    /** Wipes everything — called by auth.signOut() (old bug: ioCache stayed). */
    function clear(): void {
        clearPendingAll();
        ios.value.clear();
        rooms.value = [];
        cameras.value = [];
        audioPlayers.value = [];
        loaded.value = false;
    }

    return {
        rooms,
        ios,
        cameras,
        audioPlayers,
        pending,
        loaded,
        roomCount,
        cameraCount,
        audioPlayerCount,
        attachTransport,
        attachAudioEvents,
        getIo,
        getRoom,
        isPending,
        setHome,
        handleEvent,
        sendSetState,
        clearPending,
        clear,
    };
});
