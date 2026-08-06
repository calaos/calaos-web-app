// Audio store — per-player runtime state for the audio section.
//
// WHY THIS IS NOT PART OF stores/home.ts
//
// The house model and the audio model have different lifecycles. `get_home`
// delivers the whole house in one frame and it stays put; the audio detail
// (docs/audio-protocol.md) is deliberately NOT in that frame — upstream keeps
// status/volume/track out of get_home so the house is not delayed by round
// trips to a media server — so every player's state arrives later, per
// player, and keeps changing on its own afterwards. It also has its own event
// vocabulary and its own notion of time. Folding that into the home store
// would have meant a second, unrelated state machine inside a module whose
// job is "the house, normalized once".
//
// home.ts stays the single event entry point: its dispatch table forwards the
// three `audio_*` types here through a handler this store registers (the same
// injection pattern `attachTransport` already uses, so neither store imports
// the other).
//
// POSITION: ADVANCED LOCALLY, NOT POLLED
//
// There is no `audio_time_changed` event and no seek command; the spec's
// suggestion is to poll `{msg:"audio", audio_action:"get_time"}` while a
// player plays. This store does not, and the player view re-anchors with
// `get_state` instead. Three reasons:
//
//  1. A `get_time` reply is `{"msg":"audio","data":{"time_elapsed":"42.5"}}` —
//     no player id — so every poll would need msg_id correlation to be
//     attributed. A `get_state` reply names the player it describes.
//  2. One `get_state` re-anchors position, volume, status AND track together,
//     so a missed event heals on the same beat.
//  3. Between anchors the position is arithmetic, not traffic: a reading plus
//     the wall clock since (protocol/audio.ts `elapsedAt`). A wall panel left
//     on this screen costs one frame every 15 s instead of one per second.
//
// NOTHING HERE IS OPTIMISTIC
//
// Same rule as the home store: a command is sent, and the screen only changes
// when the server says so. Volume is the visible case — the slider thumb
// tracks the finger while dragging (BaseSlider owns that), but the store's
// value only moves on `audio_volume_changed`. If the player refuses, the
// thumb snaps back to the truth instead of lying.

import { ref } from 'vue';
import { defineStore } from 'pinia';
import {
    AUDIO_NEXT,
    AUDIO_PAUSE,
    AUDIO_PLAY,
    AUDIO_PREVIOUS,
    AUDIO_STOP,
    elapsedAt,
    toAudioEvent,
    trackKey,
    volumeSet,
} from '../protocol/audio';
import { encodeAudioQuery, encodeGetState, encodeSetState } from '../protocol/messages';
import type { AudioPlayerState, AudioQueryMessage, GetStateMessage } from '../protocol/types';

/**
 * Sends a pre-encoded frame; false when the socket is not open (the frame is
 * dropped, never queued). Attached by services/calaos.ts. Declared locally
 * rather than imported from another store, like the home store's own.
 */
export type FrameSender = (frame: string) => boolean;

/** What the app knows about a player before its first get_state lands. */
export function emptyPlayerState(): AudioPlayerState {
    return {
        status: 'unknown',
        volume: 0,
        playlistSize: 0,
        playlistCurrentTrack: 0,
        timeElapsed: 0,
        anchoredAt: 0,
        track: { title: '', artist: '', album: '', duration: 0 },
        known: false,
    };
}

/** Cover art bookkeeping for one player. */
export interface CoverInfo {
    /**
     * The track this cover belongs to (protocol/audio.ts `trackKey`). A
     * different key means the artwork on screen is the previous song's.
     */
    key: string;
    /** `get_cover_url` answer; '' means the backend has no artwork URL. */
    url: string;
    /** True once an answer landed — `url` may legitimately still be ''. */
    resolved: boolean;
}

export const useAudioStore = defineStore('audio', () => {
    /** Player id → detail. Only ids the server actually answered for. */
    const states = ref(new Map<string, AudioPlayerState>());
    /** Player id → cover art bookkeeping. */
    const covers = ref(new Map<string, CoverInfo>());

    // Not state: nothing below is rendered.
    //
    // `coverRequests` holds the msg_id of the NEWEST get_cover_url in flight
    // per player. An `audio` reply carries no player id, so this map is the
    // only way to attribute one — and keeping just the newest is what makes a
    // late reply for a song that has already changed identifiable as stale.
    const coverRequests = new Map<string, string>();
    let coverSeq = 0;
    let send: FrameSender = (frame) => {
        console.warn('calaos audio: no transport attached, dropping frame:', frame);
        return false;
    };

    /** Called once by services/calaos.ts with the socket's send(). */
    function attachTransport(sender: FrameSender): void {
        send = sender;
    }

    // -----------------------------------------------------------------------
    // reads
    // -----------------------------------------------------------------------

    /**
     * Never undefined: a player the server has not described yet reads as an
     * empty state, so every view can bind straight to it without a v-if per
     * field. `known` is what tells the two apart.
     */
    function stateFor(id: string): AudioPlayerState {
        return states.value.get(id) ?? emptyPlayerState();
    }

    /** '' when there is no artwork, or none known yet. */
    function coverUrlFor(id: string): string {
        return covers.value.get(id)?.url ?? '';
    }

    /** True once the cover question has been answered — either way. */
    function coverResolved(id: string): boolean {
        return covers.value.get(id)?.resolved ?? false;
    }

    /** Current position in seconds, advanced locally from the last anchor. */
    function elapsedFor(id: string, now: number): number {
        return elapsedAt(stateFor(id), now);
    }

    // -----------------------------------------------------------------------
    // get_state
    // -----------------------------------------------------------------------

    /**
     * Asks for detail on a batch of players — ONE frame, however many ids.
     * Returns false when nothing was sent (empty list, or socket closed).
     */
    function requestDetails(ids: string[]): boolean {
        if (ids.length === 0) return false;
        return send(encodeGetState(ids));
    }

    /**
     * Ingests a get_state answer. `msg.ios` is ignored on purpose: this store
     * only ever asks about players, and plain io state belongs to the home
     * store, which gets it from io_changed events.
     */
    function applyGetState(msg: GetStateMessage): void {
        for (const [id, state] of Object.entries(msg.players)) {
            states.value.set(id, state);
            syncCover(id, state);
        }
    }

    // -----------------------------------------------------------------------
    // cover art
    // -----------------------------------------------------------------------

    /**
     * Re-asks for artwork when — and only when — the track changed. Without
     * the key check, every 15 s re-anchor would fire a cover query for a
     * picture already on screen.
     */
    function syncCover(id: string, state: AudioPlayerState): void {
        const key = trackKey(state.track);
        if (covers.value.get(id)?.key === key) return;
        covers.value.set(id, { key, url: '', resolved: false });
        requestCover(id, key);
    }

    function requestCover(id: string, key: string): void {
        coverSeq += 1;
        const msgId = `cover-${coverSeq}`;
        if (!send(encodeAudioQuery('get_cover_url', id, msgId))) {
            // Nothing is in flight, so nothing will resolve it. Say so rather
            // than leaving the view waiting on a frame that never went out.
            covers.value.set(id, { key, url: '', resolved: true });
            return;
        }
        coverRequests.set(id, msgId);
    }

    /**
     * Matches an `audio` reply back to the player that asked. A reply whose
     * msg_id is not the newest for any player is stale — the song changed
     * while it was in flight — and is dropped rather than painting the
     * previous song's artwork over the current one.
     */
    function applyAudioQuery(msg: AudioQueryMessage): void {
        let owner: string | undefined;
        for (const [id, msgId] of coverRequests) {
            if (msgId === msg.msgId) owner = id;
        }
        if (owner === undefined) return;
        coverRequests.delete(owner);

        const current = covers.value.get(owner);
        covers.value.set(owner, {
            key: current?.key ?? '',
            // An error reply ('unkown player_id', 'empty player id') is a
            // resolved "no artwork", not a retry: the id is not going to
            // become valid on its own.
            url: msg.error === '' ? msg.cover : '',
            resolved: true,
        });
    }

    // -----------------------------------------------------------------------
    // events
    // -----------------------------------------------------------------------

    /**
     * Handles the three `audio_*` events, forwarded by the home store's
     * dispatch table. Never throws: an event for a player that is not in the
     * house yet creates its entry, because the event may well arrive before
     * the get_state answer it belongs to.
     *
     * `io_changed` frames a player also emits — the raw command echo
     * (`state:"volume set 55"`) and the `onplay`/`onpause`/… status mirrors —
     * are NOT handled here. They carry the same information one layer less
     * precisely, and the home store already tolerates them; handling both
     * would apply every change twice.
     */
    function handleAudioEvent(typeStr: string, data: unknown): void {
        const event = toAudioEvent(typeStr, data);
        if (event === null) {
            console.debug(`calaos audio: ignoring malformed "${typeStr}" event`, data);
            return;
        }

        const now = Date.now();
        const state = states.value.get(event.playerId) ?? emptyPlayerState();

        switch (event.kind) {
            case 'status':
                // Freeze the running position at the moment of the flip before
                // changing status: pausing at 1:12 must display 1:12, not the
                // reading from whenever the last anchor was taken.
                state.timeElapsed = elapsedAt(state, now);
                state.anchoredAt = now;
                state.status = event.status;
                // Whether a stopped player rewinds to 0 is on the spec's
                // unverified list, so it is asked rather than assumed.
                if (event.status === 'stop') requestDetails([event.playerId]);
                break;

            case 'volume':
                state.volume = event.volume;
                break;

            case 'song':
                // The event carries nothing but the id. Position restarts and
                // the new title/duration/artwork all come from get_state.
                state.timeElapsed = 0;
                state.anchoredAt = now;
                requestDetails([event.playerId]);
                break;
        }

        states.value.set(event.playerId, state);
    }

    // -----------------------------------------------------------------------
    // commands
    // -----------------------------------------------------------------------

    /** Transport and volume both ride an ordinary set_state (there is no `audio` command path). */
    function sendCommand(id: string, value: string): boolean {
        return send(encodeSetState(id, value));
    }

    const play = (id: string): boolean => sendCommand(id, AUDIO_PLAY);
    const pause = (id: string): boolean => sendCommand(id, AUDIO_PAUSE);
    const stop = (id: string): boolean => sendCommand(id, AUDIO_STOP);
    const next = (id: string): boolean => sendCommand(id, AUDIO_NEXT);
    const previous = (id: string): boolean => sendCommand(id, AUDIO_PREVIOUS);

    /** Slider release. Absolute only — see protocol/audio.ts `volumeSet`. */
    const setVolume = (id: string, percent: number): boolean =>
        sendCommand(id, volumeSet(percent));

    // -----------------------------------------------------------------------
    // teardown
    // -----------------------------------------------------------------------

    /**
     * Wipes everything, including the in-flight cover correlations — a reply
     * that lands after a sign-out must not attach artwork to the next
     * session's player of the same id.
     */
    function clear(): void {
        states.value.clear();
        covers.value.clear();
        coverRequests.clear();
    }

    return {
        states,
        covers,
        attachTransport,
        stateFor,
        coverUrlFor,
        coverResolved,
        elapsedFor,
        requestDetails,
        applyGetState,
        applyAudioQuery,
        handleAudioEvent,
        sendCommand,
        play,
        pause,
        stop,
        next,
        previous,
        setVolume,
        clear,
    };
});
