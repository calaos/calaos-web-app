// Audio domain — the wire vocabulary of calaos audio players and the pure
// parsers/builders the audio store and views are built on. NO Vue imports in
// this directory.
//
// Everything here is derived from docs/audio-protocol.md (T16), which cites
// calaos_base master `ac5a6b3` line by line. Three findings shape this file:
//
//  - calaos speaks TWO status vocabularies for one concept: `get_state`
//    answers `playing`, the `audio_status_changed` event says `play`.
//    `normalizeAudioStatus` is the ONLY place in the app that knows this, so
//    nothing downstream ever has to compare against both spellings.
//  - The server never volunteers position. There is no `audio_time_changed`
//    event and no seek command, so `time_elapsed` is an ANCHOR: a reading
//    plus the wall clock at which it was read. `elapsedAt()` advances it
//    locally from there (see stores/audio.ts for why polling `get_time` was
//    not chosen).
//  - Everything on the wire is a string, and half of it is optional. Track
//    metadata is a pass-through of whatever the media backend returned —
//    full LMS tags for a local file, four keys for a radio stream — so every
//    field parses to a neutral default and the views hide what is missing
//    (docs/audio-protocol.md "Unverified": `current_track` key set).

import { isRecord, toWireString } from './guards';
import type { AudioPlayerState, AudioStatus, AudioTrack } from './types';

// ---------------------------------------------------------------------------
// Commands — the exact `set_state` value strings (docs/audio-protocol.md
// "Transport & volume commands"). AudioPlayer::set_value swallows anything it
// does not recognize (it echoes the raw string back as an io_changed and
// returns true either way), so a typo here is silent: these constants exist
// so there is exactly one spelling of each in the app.
// ---------------------------------------------------------------------------

export const AUDIO_PLAY = 'play';
export const AUDIO_PAUSE = 'pause';
export const AUDIO_STOP = 'stop';
export const AUDIO_NEXT = 'next';
/**
 * `previous`, NOT `prev`. The old app sent `prev` (src/views/audio_player.html)
 * which set_value does not know — it echoed it and did nothing, which is why
 * the old previous button never worked.
 */
export const AUDIO_PREVIOUS = 'previous';

/**
 * Absolute volume. The relative forms (`volume up N` / `volume down N`) are
 * deliberately not built here: the app only ever commits a slider position,
 * and the spec lists argument-less `volume up`/`volume down` as unverified
 * behaviour. Sending only the absolute form sidesteps that question entirely.
 */
export function volumeSet(percent: number): string {
    return `volume set ${clampVolume(percent)}`;
}

/** 0-100 integer, the range LMS's mixer takes. NaN → 0. */
export function clampVolume(percent: number): number {
    if (!Number.isFinite(percent)) return 0;
    return Math.min(100, Math.max(0, Math.round(percent)));
}

// ---------------------------------------------------------------------------
// Status vocabulary
// ---------------------------------------------------------------------------

/**
 * The one bridge between the two spellings. `get_state` reports
 * `playing|pause|stop|error|song_change`; `audio_status_changed` reports
 * `play|pause|stop`. Both normalize to the `get_state` spelling, which is the
 * richer of the two. Anything else — including a player whose detail has not
 * landed yet — is `unknown`, which the views render as "no status" rather
 * than guessing.
 */
export function normalizeAudioStatus(raw: unknown): AudioStatus {
    switch (toWireString(raw)) {
        case 'play':
        case 'playing':
            return 'playing';
        // 'paused'/'stopped' are defensive: no source spells them that way,
        // but a past-tense variant costs nothing to accept and would
        // otherwise read as 'unknown'.
        case 'pause':
        case 'paused':
            return 'pause';
        case 'stop':
        case 'stopped':
            return 'stop';
        case 'error':
            return 'error';
        case 'song_change':
            return 'song_change';
        default:
            return 'unknown';
    }
}

/** True only while the position is actually moving. */
export function isPlaying(status: AudioStatus): boolean {
    return status === 'playing';
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Seconds from a wire decimal string. `parseFloat`, never a string compare —
 * `Utils::to_string(double)`'s exact precision is on the spec's unverified
 * list, so `'42.5'`, `'42.500000'` and `'42'` must all mean the same thing.
 */
export function toSeconds(raw: unknown): number {
    const value = parseFloat(toWireString(raw, ''));
    return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * `current_track` — a pass-through of the backend's song info. Only the four
 * keys every backend agrees on are read (Squeezebox's LMS tags, its radio
 * fallback, and Roon all carry these); the rest (id, genre, bitrate, type,
 * coverart…) are ignored rather than typed, because which of them appear
 * depends on the media and is unverified against a real LMS.
 */
export function toAudioTrack(raw: unknown): AudioTrack {
    const obj = isRecord(raw) ? raw : {};
    return {
        title: toWireString(obj.title),
        artist: toWireString(obj.artist),
        album: toWireString(obj.album),
        duration: toSeconds(obj.duration),
    };
}

/**
 * One player's `get_state` expansion. `at` is the wall clock the reading was
 * taken at — the anchor `elapsedAt()` counts forward from.
 *
 * Every field is optional on the way in: a server older or newer than the
 * spec, or a backend that answers slowly, produces a partial object rather
 * than a broken screen.
 */
export function toAudioPlayerState(raw: unknown, at: number): AudioPlayerState {
    const obj = isRecord(raw) ? raw : {};
    return {
        status: normalizeAudioStatus(obj.status),
        volume: clampVolume(Number(toWireString(obj.volume, '0'))),
        playlistSize: toIndex(obj.playlist_size),
        playlistCurrentTrack: toIndex(obj.playlist_current_track),
        timeElapsed: toSeconds(obj.time_elapsed),
        anchoredAt: at,
        track: toAudioTrack(obj.current_track),
        // Detail landed: this player is no longer a name with no state.
        known: true,
    };
}

/** Non-negative integer from a wire string; anything odd → 0. */
function toIndex(raw: unknown): number {
    const value = Number(toWireString(raw, '0'));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

// ---------------------------------------------------------------------------
// Position
// ---------------------------------------------------------------------------

/**
 * Where the player is NOW, in seconds. While playing, the last reading plus
 * the wall time since it was taken; otherwise the reading itself.
 *
 * Clamped to `[0, duration]` when a duration is known — the spec cannot say
 * whether a stopped LMS resets `time_elapsed` to 0, and a local clock that
 * outran the track would otherwise show 4:11 of a 3:07 song. A duration of 0
 * (radio streams send `"0"`) means "unbounded" and clamps at the low end only.
 */
export function elapsedAt(state: AudioPlayerState, now: number): number {
    const advanced = isPlaying(state.status)
        ? state.timeElapsed + Math.max(0, (now - state.anchoredAt) / 1000)
        : state.timeElapsed;
    const capped = state.track.duration > 0 ? Math.min(advanced, state.track.duration) : advanced;
    return Math.max(0, capped);
}

/** `0:42`, `3:07`, `1:02:33`. Seconds are floored, never rounded up past the end. */
export function formatClock(seconds: number): string {
    const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    const secs = total % 60;
    const mins = Math.floor(total / 60) % 60;
    const hours = Math.floor(total / 3600);
    const mm = hours > 0 ? String(mins).padStart(2, '0') : String(mins);
    const ss = String(secs).padStart(2, '0');
    return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Identity of the thing currently playing, used to decide when cover art has
 * gone stale. Not the playlist index: `next` on a one-track playlist wraps to
 * the same index, and a radio stream changes song without changing index at
 * all — the metadata IS the identity.
 */
export function trackKey(track: AudioTrack): string {
    return [track.artist, track.album, track.title].join('|');
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** The three audio event types the app implements, keyed by `player_id`. */
export type AudioEvent =
    | { kind: 'status'; playerId: string; status: AudioStatus }
    | { kind: 'volume'; playerId: string; volume: number }
    | { kind: 'song'; playerId: string };

/**
 * Typed view of an `audio_*` event payload, or null when the frame is not one
 * the app handles (or carries no `player_id`, which no upstream emitter does
 * but a malformed frame could).
 *
 * Note the key: audio events say `player_id`, plain `io_changed` says `id`.
 * Mixing them up is the reason this conversion lives in one function.
 */
export function toAudioEvent(typeStr: string, data: unknown): AudioEvent | null {
    const obj = isRecord(data) ? data : {};
    const playerId = toWireString(obj.player_id);
    if (playerId === '') return null;

    switch (typeStr) {
        case 'audio_status_changed':
            return { kind: 'status', playerId, status: normalizeAudioStatus(obj.state) };
        case 'audio_volume_changed':
            return {
                kind: 'volume',
                playerId,
                volume: clampVolume(Number(toWireString(obj.volume, '0'))),
            };
        case 'audio_song_changed':
            // Carries nothing but the id. The new track, its duration and the
            // reset position all have to be re-fetched with get_state.
            return { kind: 'song', playerId };
        default:
            return null;
    }
}
