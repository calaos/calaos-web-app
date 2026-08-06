// Mutable home state for the mock calaos_server.
//
// Holds a mutable clone of fixtures/home.json, applies naive `set_state`
// transitions and hands the resulting `io_changed` event to the injected
// `broadcast` callback. Everything on the wire is a STRING (see
// docs/ARCHITECTURE.md "Protocol layer") — every value written here stays a
// string on purpose.

import { readFileSync } from 'node:fs';

const FIXTURE_URL = new URL('./fixtures/home.json', import.meta.url);
const AUDIO_FIXTURE_URL = new URL('./fixtures/audio.json', import.meta.url);

/** Re-read (not cache) so `/control {op:'reset'}` also picks up fixture edits. */
function loadFixture() {
    return JSON.parse(readFileSync(FIXTURE_URL, 'utf8'));
}

function loadAudioFixture() {
    return JSON.parse(readFileSync(AUDIO_FIXTURE_URL, 'utf8'));
}

/** Wire event frame for a single IO state change. */
export function ioChangedEvent(id, state) {
    return {
        msg: 'event',
        data: {
            type_str: 'io_changed',
            data: { id, state },
        },
    };
}

/**
 * Numeric event ids from the CalaosEvent enum, calaos_base
 * src/bin/calaos_server/EventManager.h (EventUnkown = 0, counting up).
 */
const AUDIO_EVENT_TYPES = {
    audio_song_changed: 13,
    audio_status_changed: 19,
    audio_volume_changed: 20,
};

/**
 * Wire frame for an audio event. Unlike the mock's reduced `io_changed`
 * envelope (kept for backward compat with existing tests), audio events carry
 * the FULL envelope the real server sends — `CalaosEvent::toJson()` in
 * calaos_base src/bin/calaos_server/EventManager.cpp:
 * `{event_raw, type, type_str, data}`, all values strings.
 */
export function audioEvent(typeStr, params) {
    const raw = [
        typeStr,
        ...Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}:${encodeURIComponent(v)}`),
    ].join(' ');
    return {
        msg: 'event',
        data: {
            event_raw: raw,
            type: String(AUDIO_EVENT_TYPES[typeStr]),
            type_str: typeStr,
            data: params,
        },
    };
}

/** Clamp to the 0-100 range calaos uses for dimmers / shutter percentages. */
function clampPercent(n) {
    if (!Number.isFinite(n)) return 0;
    return String(Math.min(100, Math.max(0, Math.round(n))));
}

/** Squeezebox/LMS mixer volume is an integer percent, clamped to 0-100. */
function clampVolume(n) {
    if (!Number.isFinite(n)) return 0;
    return Math.min(100, Math.max(0, Math.round(n)));
}

/**
 * `time_elapsed` renders like the real server's `Utils::to_string(double)`
 * (plain decimal, no trailing zeros); the mock rounds to 0.1 s.
 */
function formatSeconds(n) {
    return String(Math.round(n * 10) / 10);
}

/** Parse `'up 30'` / `'down 100'` / `'stop 55'` into its two parts. */
function parseShutterSmart(state) {
    const match = /^(up|down|stop)\s+(-?\d+)$/.exec(String(state).trim());
    if (!match) return { action: 'stop', percent: 0 };
    return { action: match[1], percent: Number(match[2]) };
}

/** Percentage carried by a dimmer state (`'42'`, `'set 42'`, `'true'`, `'false'`). */
function parseDimmer(state) {
    const s = String(state).trim();
    if (s === 'true') return 100;
    if (s === 'false') return 0;
    const setMatch = /^set\s+(-?\d+)$/.exec(s);
    if (setMatch) return Number(setMatch[1]);
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? 0 : n;
}

function parseNumber(state) {
    const n = parseFloat(state);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Naive per-gui_type transition: given the current IO and the `set_state`
 * value, return the new state string, or `null` when the value is a no-op
 * (unknown action, read-only IO type, scenario trigger).
 *
 * `lastColor` is the last non-black colour seen for a light_rgb IO, used to
 * restore it on `'true'`. It is kept outside the IO object so nothing but the
 * fixture's own fields ever reaches the wire.
 *
 * Deliberate deviations from a "value becomes state" passthrough, so the mock
 * stays consistent with the parsers in docs/ARCHITECTURE.md:
 *  - `shutter` state is `'true'`/`'false'` (open/closed), so up/down map onto
 *    those rather than being stored verbatim.
 *  - `shutter_smart` recomposes `'<action> <pct>'`: up drives to 0 (open),
 *    down to 100 (closed), stop freezes the current percentage.
 *  - `scenario` is fire-and-forget: no state change, hence no broadcast (the
 *    frame is still recorded in the /control log).
 */
export function nextState(io, value, lastColor = '#ffffff') {
    const v = String(value);
    const current = String(io.state ?? '');

    switch (io.gui_type) {
        // Read-only types: nothing a client sends can change them.
        case 'temp':
        case 'analog_in':
        case 'string_in':
            return null;

        case 'light':
        case 'var_bool':
            return v === 'true' || v === 'false' ? v : null;

        case 'light_dimmer': {
            if (v === 'true') return '100';
            if (v === 'false') return '0';
            const setMatch = /^set\s+(-?\d+)$/.exec(v);
            if (setMatch) return clampPercent(Number(setMatch[1]));
            if (/^-?\d+$/.test(v)) return clampPercent(Number(v));
            if (v === 'inc') return clampPercent(parseDimmer(current) + 10);
            if (v === 'dec') return clampPercent(parseDimmer(current) - 10);
            return null;
        }

        case 'light_rgb': {
            const setColor = /^set\s+(#[0-9a-fA-F]{6})$/.exec(v);
            if (setColor) return setColor[1].toLowerCase();
            if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
            // 'false' means off; remember the colour so 'true' can restore it.
            if (v === 'false') return '#000000';
            if (v === 'true') {
                const isOff = current === '0' || current === '#000000' || current === '';
                return isOff ? lastColor : current;
            }
            return null;
        }

        case 'shutter':
            if (v === 'up' || v === 'true') return 'true';
            if (v === 'down' || v === 'false') return 'false';
            return null; // 'stop' freezes: no observable change

        case 'shutter_smart': {
            const { percent } = parseShutterSmart(current);
            if (v === 'up') return 'up 0';
            if (v === 'down') return 'down 100';
            if (v === 'stop') return `stop ${clampPercent(percent)}`;
            const setMatch = /^set\s+(-?\d+)$/.exec(v);
            if (setMatch) return `stop ${clampPercent(Number(setMatch[1]))}`;
            return null;
        }

        case 'var_int':
        case 'analog_out': {
            if (v === 'inc') return String(parseNumber(current) + 1);
            if (v === 'dec') return String(parseNumber(current) - 1);
            const setMatch = /^set\s+(-?\d+(?:\.\d+)?)$/.exec(v);
            if (setMatch) return String(Number(setMatch[1]));
            if (/^-?\d+(?:\.\d+)?$/.test(v)) return String(Number(v));
            return null;
        }

        // Raw text, no prefix (docs/ARCHITECTURE.md IO state parser table).
        case 'var_string':
        case 'string_out':
            return v;

        case 'scenario':
            return null;

        default:
            return null;
    }
}

/**
 * @param {{ broadcast?: (frame: object) => void }} [options]
 *   `broadcast` receives ready-to-send wire frames; the transport lives in
 *   index.mjs so this module stays testable on its own.
 */
export function createState({ broadcast = () => {} } = {}) {
    /** @type {{home: object[], cameras: object[], audio: object[]}} */
    let home;
    /** @type {Map<string, object>} */
    let ios;
    /** Last non-black colour per light_rgb id — never serialised to the wire. */
    let lastColors;
    /**
     * Audio player runtime state, keyed by player id (fixtures/audio.json).
     * Wire-facing fields stay strings; `elapsedBase`/`playingSince` are
     * mock-internal numbers driving the `time_elapsed` clock.
     * @type {Map<string, object>}
     */
    let players;

    function reindex() {
        ios = new Map();
        lastColors = new Map();
        for (const room of home.home ?? []) {
            for (const io of room.items ?? []) ios.set(io.id, io);
        }
    }

    function reset() {
        home = loadFixture();
        reindex();

        players = new Map();
        for (const [id, seed] of Object.entries(loadAudioFixture())) {
            players.set(id, {
                status: seed.status, // 'playing' | 'pause' | 'stop' (get_state vocabulary)
                volume: clampVolume(Number(seed.volume)),
                index: Number(seed.playlist_current_track) || 0,
                playlist: seed.playlist ?? [],
                artworkTrackId: seed.artwork_track_id ?? '',
                elapsedBase: Number(seed.time_elapsed) || 0,
                playingSince: seed.status === 'playing' ? Date.now() : null,
            });
        }
    }

    reset();

    // ---------------------------------------------------------- audio ---

    function timeElapsed(p) {
        return p.elapsedBase + (p.playingSince !== null ? (Date.now() - p.playingSince) / 1000 : 0);
    }

    /** Freeze the elapsed clock into elapsedBase (pause/stop bookkeeping). */
    function freezeClock(p) {
        p.elapsedBase = timeElapsed(p);
        p.playingSince = null;
    }

    /**
     * Move player to `status` ('playing'|'pause'|'stop') and, when it actually
     * changes, replay the real server's two frames: the audio_status_changed
     * event (state 'play'|'pause'|'stop' — Squeezebox.cpp
     * processNotificationMessage) and the io_changed 'on<state>' frame
     * (AudioPlayer::hasChanged via set_status).
     */
    function setPlayerStatus(id, p, status, eventState) {
        if (p.status === status) return;
        if (status === 'playing') {
            p.playingSince = Date.now();
        } else {
            freezeClock(p);
            if (status === 'stop') p.elapsedBase = 0;
        }
        p.status = status;
        broadcast(audioEvent('audio_status_changed', { player_id: id, state: eventState }));
        broadcast(ioChangedEvent(id, `on${eventState}`));
    }

    function setPlayerVolume(id, p, volume) {
        const next = clampVolume(volume);
        if (next === p.volume) return;
        p.volume = next;
        broadcast(audioEvent('audio_volume_changed', { player_id: id, volume: String(next) }));
        broadcast(ioChangedEvent(id, 'onvolumechange'));
    }

    function changeTrack(id, p, direction) {
        const size = p.playlist.length;
        if (size > 0) p.index = (p.index + direction + size) % size;
        p.elapsedBase = 0;
        if (p.playingSince !== null) p.playingSince = Date.now();
        broadcast(audioEvent('audio_song_changed', { player_id: id }));
        broadcast(ioChangedEvent(id, 'onsongchange'));
    }

    return {
        reset,

        /** The `get_home` payload: `{home, cameras, audio}`. */
        getHome() {
            return home;
        },

        getIo(id) {
            return ios.get(id);
        },

        getCamera(id) {
            return (home.cameras ?? []).find((camera) => camera.id === id);
        },

        ioIds() {
            return [...ios.keys()];
        },

        // ------------------------------------------------------ audio ---

        audioPlayerIds() {
            return [...players.keys()];
        },

        isAudioPlayer(id) {
            return players.has(id);
        },

        /** Current playlist track (empty object when the playlist is empty). */
        audioCurrentTrack(id) {
            const p = players.get(id);
            if (!p) return {};
            return p.playlist[p.index] ?? {};
        },

        /**
         * Mock-internal artwork id for the current track ('' = no cover),
         * used by index.mjs to build the LMS-style cover URL.
         */
        audioArtworkTrackId(id) {
            return players.get(id)?.artworkTrackId ?? '';
        },

        audioPlaylistSize(id) {
            return players.get(id)?.playlist.length ?? 0;
        },

        audioPlaylistItem(id, index) {
            return players.get(id)?.playlist[index];
        },

        audioTimeElapsed(id) {
            const p = players.get(id);
            return p ? formatSeconds(timeElapsed(p)) : '0';
        },

        /**
         * The per-player object `get_state` returns for an audio player id —
         * `JsonApi::buildJsonState` (calaos_base src/bin/calaos_server/
         * JsonApi.cpp): status is 'playing'|'pause'|'stop' here, while events
         * carry 'play' (asymmetry faithful to upstream).
         */
        audioPlayerState(id) {
            const p = players.get(id);
            if (!p) return undefined;
            return {
                playlist_current_track: String(p.index),
                volume: String(p.volume),
                playlist_size: String(p.playlist.length),
                time_elapsed: formatSeconds(timeElapsed(p)),
                status: p.status,
                current_track: { ...(p.playlist[p.index] ?? {}) },
            };
        },

        /** The `get_playlist` payload — `JsonApi::decodeGetPlaylist`. */
        audioPlaylist(id) {
            const p = players.get(id);
            if (!p) return undefined;
            return {
                current_track: String(p.index),
                count: String(p.playlist.length),
                items: p.playlist.map((track) => ({ ...track })),
            };
        },

        /**
         * Apply an `AudioPlayer::set_value` command (calaos_base
         * src/bin/calaos_server/Audio/AudioPlayer.cpp). Mirrors the real
         * frame sequence: an io_changed echoing the raw command always fires
         * first, then the audio event + io_changed 'on<state>' pair when the
         * player state actually changed. Unknown commands are accepted
         * (echo only), like upstream. @returns {boolean} id is a player
         */
        applyAudioCommand(id, value) {
            const p = players.get(id);
            if (!p) return false;
            const v = String(value);

            broadcast(ioChangedEvent(id, v)); // set_value's unconditional echo

            if (v === 'play') setPlayerStatus(id, p, 'playing', 'play');
            else if (v === 'pause') setPlayerStatus(id, p, 'pause', 'pause');
            else if (v === 'stop') setPlayerStatus(id, p, 'stop', 'stop');
            else if (v === 'next') changeTrack(id, p, +1);
            else if (v === 'previous') changeTrack(id, p, -1);
            else if (v.startsWith('volume set ')) {
                setPlayerVolume(id, p, Number(v.slice('volume set '.length)));
            } else if (v.startsWith('volume up ')) {
                setPlayerVolume(id, p, p.volume + (Number(v.slice('volume up '.length)) || 0));
            } else if (v.startsWith('volume down ')) {
                setPlayerVolume(id, p, p.volume - (Number(v.slice('volume down '.length)) || 0));
            }
            // power on/off, sleep N, sync/unsync, play/add <items>: accepted
            // upstream but with no observable effect on this mock's state.

            return true;
        },

        /**
         * Force audio player state + events (`/control {op:'push_audio'}`).
         * `status` uses the event vocabulary ('play'|'pause'|'stop');
         * unknown ids still broadcast (parity with pushIo) so clients'
         * handling of events for unknown players can be exercised.
         * @returns {boolean} whether the id exists in the audio fixture
         */
        pushAudio(id, { status, volume, track } = {}) {
            const p = players.get(id);

            if (status !== undefined) {
                const s = String(status);
                if (p) {
                    const canonical = s === 'play' ? 'playing' : s;
                    if (canonical === 'playing' && p.playingSince === null) {
                        p.playingSince = Date.now();
                    } else if (canonical !== 'playing') {
                        freezeClock(p);
                        if (canonical === 'stop') p.elapsedBase = 0;
                    }
                    p.status = canonical;
                }
                broadcast(audioEvent('audio_status_changed', { player_id: id, state: s }));
            }

            if (volume !== undefined) {
                const vol = clampVolume(Number(volume));
                if (p) p.volume = vol;
                broadcast(audioEvent('audio_volume_changed', { player_id: id, volume: String(vol) }));
            }

            if (track !== undefined) {
                if (p && track && typeof track === 'object') {
                    p.playlist[p.index] = { ...track };
                    p.elapsedBase = 0;
                    if (p.playingSince !== null) p.playingSince = Date.now();
                }
                broadcast(audioEvent('audio_song_changed', { player_id: id }));
            }

            return Boolean(p);
        },

        /**
         * Force an IO to a state and broadcast it, no transition rules applied
         * (`/control {op:'push_io'}`). Unknown ids are still broadcast so E2E
         * can exercise the client's handling of events for unknown IOs.
         * @returns {boolean} whether the id exists in the fixture
         */
        pushIo(id, state) {
            const io = ios.get(id);
            const next = String(state);
            if (io) io.state = next;
            broadcast(ioChangedEvent(id, next));
            return Boolean(io);
        },

        /**
         * Apply a `set_state` value. Broadcasts `io_changed` to every client
         * when (and only when) the state actually changed.
         * @returns {{id: string, state: string} | null} the applied change
         */
        applySetState(id, value) {
            const io = ios.get(id);
            if (!io) return null;

            const next = nextState(io, value, lastColors.get(id) ?? '#ffffff');
            if (next === null || next === io.state) return null;

            // Remember the last lit colour so light_rgb 'true' can restore it.
            if (io.gui_type === 'light_rgb' && io.state !== '0' && io.state !== '#000000') {
                lastColors.set(id, io.state);
            }

            io.state = next;
            broadcast(ioChangedEvent(id, next));
            return { id, state: next };
        },
    };
}
