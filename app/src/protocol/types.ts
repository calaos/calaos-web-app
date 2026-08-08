// Protocol types — wire shapes as sent by calaos_server and the typed domain
// model used by the app. NO Vue imports in this directory.
//
// Wire contract (see docs/ARCHITECTURE.md "Protocol layer"): every value is a
// STRING on the wire — booleans arrive as 'true'/'false', numbers as '42'.
// guards.ts converts `visible`/`rw` to real booleans once at ingest; `state`
// stays a raw string and is parsed on demand by io-states.ts.

// ---------------------------------------------------------------------------
// Wire shapes (documentation of what the server sends; runtime input is
// treated as `unknown` by guards.ts and never trusted to match these).
// ---------------------------------------------------------------------------

export interface WireIo {
    id?: string;
    name?: string;
    gui_type?: string;
    /** The style the server actually sends. */
    io_style?: string;
    /** What the old AngularJS templates read. Never sent by calaos_server. */
    gui_style?: string;
    state?: string;
    visible?: string;
    rw?: string;
    unit?: string;
    /** Per-IO sensor telemetry: battery, signal, connectivity. */
    status_info?: Record<string, unknown>;
}

export interface WireRoom {
    name?: string;
    type?: string;
    hits?: string;
    items?: WireIo[];
}

export interface WireCamera {
    id?: string;
    name?: string;
}

export interface WireAudioPlayer {
    id?: string;
    name?: string;
    type?: string;
    playlist?: string;
    database?: string;
    avr?: string;
}

export interface WireHome {
    home?: WireRoom[];
    cameras?: WireCamera[];
    audio?: WireAudioPlayer[];
}

// ---------------------------------------------------------------------------
// Typed domain model
// ---------------------------------------------------------------------------

// The 14 gui_types dispatched by the old app (src/views/room.html ng-switch),
// in the same order. Anything else falls back to guiType 'unknown'.
export const GUI_TYPES = [
    'temp',
    'analog_in',
    'string_in',
    'light',
    'analog_out',
    'light_dimmer',
    'light_rgb',
    'shutter',
    'shutter_smart',
    'var_bool',
    'var_int',
    'var_string',
    'string_out',
    'scenario',
] as const;

export type GuiType = (typeof GUI_TYPES)[number];

/**
 * An IO's `status_info` block, as calaos_server sends it and as
 * calaos_mobile's `IOBase::ioStatusChanged` reads it.
 *
 * Every field is independently optional — a mains-powered zigbee bulb reports
 * a signal and no battery, a battery sensor the reverse — so each is `null`
 * when absent rather than defaulted to a number that would render as a real
 * (and wrong) reading.
 */
export interface IoStatusInfo {
    /** 0-100. */
    batteryLevel: number | null;
    /** 0-100. */
    wirelessSignal: number | null;
    connected: boolean | null;
    /** Seconds. */
    uptime: number | null;
    ipAddress: string;
    wifiSsid: string;
}

interface IoBase {
    id: string;
    name: string;
    // Raw wire state string, parsed on demand by io-states.ts.
    state: string;
    // Converted from the wire strings 'true'/'false' at ingest (guards.ts).
    visible: boolean;
    /**
     * The `Internal` types' "enable edit mode" flag. Absent — hence false —
     * for every other type, where it carries NO meaning: see
     * `rwGatesControls` in guards.ts for which types may consult it.
     */
    rw: boolean;
    unit: string;
    /**
     * The server's `io_style` — the sub-kind of an IO, which for a `light`
     * picks between a lamp, an outlet, a pump, a heater and a boiler, and for
     * an analog input picks the dial's glyph. '' when unset; io-states.ts
     * falls back to the 'default' icon.
     */
    ioStyle: string;
    /**
     * Sensor telemetry the server attaches to IOs that have a radio or a
     * battery (zigbee, z-wave…). `null` when the IO sent no `status_info` at
     * all — which is most of them.
     */
    status: IoStatusInfo | null;
}

export interface TempIo extends IoBase { guiType: 'temp' }
export interface AnalogInIo extends IoBase { guiType: 'analog_in' }
export interface StringInIo extends IoBase { guiType: 'string_in' }
export interface LightIo extends IoBase { guiType: 'light' }
export interface AnalogOutIo extends IoBase { guiType: 'analog_out' }
export interface LightDimmerIo extends IoBase { guiType: 'light_dimmer' }
export interface LightRgbIo extends IoBase { guiType: 'light_rgb' }
export interface ShutterIo extends IoBase { guiType: 'shutter' }
export interface ShutterSmartIo extends IoBase { guiType: 'shutter_smart' }
export interface VarBoolIo extends IoBase { guiType: 'var_bool' }
export interface VarIntIo extends IoBase { guiType: 'var_int' }
export interface VarStringIo extends IoBase { guiType: 'var_string' }
export interface StringOutIo extends IoBase { guiType: 'string_out' }
export interface ScenarioIo extends IoBase { guiType: 'scenario' }
export interface UnknownIo extends IoBase {
    guiType: 'unknown';
    // The gui_type string actually received ('' if absent), kept for display
    // by the UnknownIo fallback component.
    rawGuiType: string;
}

export type IoItem =
    | TempIo
    | AnalogInIo
    | StringInIo
    | LightIo
    | AnalogOutIo
    | LightDimmerIo
    | LightRgbIo
    | ShutterIo
    | ShutterSmartIo
    | VarBoolIo
    | VarIntIo
    | VarStringIo
    | StringOutIo
    | ScenarioIo
    | UnknownIo;

export interface Room {
    name: string;
    type: string;
    // Numeric at ingest (wire sends a string). Rooms are sorted desc by hits
    // in the home store, not here — guards preserve wire order.
    hits: number;
    items: IoItem[];
}

export interface CameraItem {
    id: string;
    name: string;
}

/**
 * One entry of `get_home.audio` — basic info ONLY (docs/audio-protocol.md
 * "get_home: the `audio` array", JsonApi::buildJsonAudio).
 *
 * There is deliberately no status, volume, position or current_track here:
 * upstream keeps them out of get_home so the house does not wait on round
 * trips to the media server. Runtime detail arrives separately as
 * `AudioPlayerState` (get_state), which is why the audio store exists.
 */
export interface AudioPlayerItem {
    id: string;
    name: string;
    /** Backend io type — `slim` (Squeezebox), `Roon`, or something newer. */
    type: string;
    /** `canPlaylist()`. */
    canPlaylist: boolean;
    /** `canDatabase()` — false means the music-library browser is unavailable. */
    canDatabase: boolean;
    /** Linked AV receiver io id; '' when the player has no `amp` param. */
    avr: string;
}

/**
 * Normalized player status. calaos speaks two vocabularies for one concept —
 * get_state answers `playing`, `audio_status_changed` answers `play` — and
 * protocol/audio.ts `normalizeAudioStatus` is the single place that bridges
 * them. `unknown` is both "the server said something new" and "detail has not
 * landed yet"; the views show no status rather than guessing.
 */
export type AudioStatus = 'playing' | 'pause' | 'stop' | 'error' | 'song_change' | 'unknown';

/**
 * The four `current_track` keys every backend agrees on. Anything beyond them
 * (LMS's id/genre/bitrate/type/coverart) is media-dependent and unverified
 * against a real library, so it is not typed and not read.
 */
export interface AudioTrack {
    title: string;
    artist: string;
    album: string;
    /** Seconds; 0 when absent or unbounded (radio streams send `"0"`). */
    duration: number;
}

/** One player's `get_state` expansion (docs/audio-protocol.md "get_state"). */
export interface AudioPlayerState {
    status: AudioStatus;
    /** 0-100; 0 when the server sent no `volume`. */
    volume: number;
    playlistSize: number;
    playlistCurrentTrack: number;
    /**
     * Seconds, as read at `anchoredAt`. NOT the current position — there is
     * no position event and no seek, so the app advances this locally
     * (protocol/audio.ts `elapsedAt`).
     */
    timeElapsed: number;
    /** Date.now() at which `timeElapsed` was last set from the server. */
    anchoredAt: number;
    track: AudioTrack;
    /** False until a get_state for this player has landed. */
    known: boolean;
}

export interface HomeData {
    rooms: Room[];
    cameras: CameraItem[];
    audio: AudioPlayerItem[];
}

// ---------------------------------------------------------------------------
// Decoded server messages (messages.ts decodeServerMessage)
// ---------------------------------------------------------------------------

export interface LoginResultMessage {
    kind: 'login';
    // true ⇔ wire data.success is the STRING 'true' (old code: !== 'true').
    success: boolean;
}

export interface GetHomeMessage {
    kind: 'get_home';
    home: HomeData;
}

/**
 * A `get_state` answer. The wire `data` is one flat map mixing both kinds of
 * entry — a plain IO maps to its state string, an id whose IO is an
 * `audio_player` maps to a detail object (JsonApi::buildJsonState) — so the
 * decoder splits them by shape and hands over two maps.
 *
 * `msgId` is '' unless the request carried one; the app does not need it,
 * because every entry names the io it belongs to.
 */
export interface GetStateMessage {
    kind: 'get_state';
    msgId: string;
    /** id → raw state string, for non-player ios. */
    ios: Record<string, string>;
    /** id → detail, for audio players. */
    players: Record<string, AudioPlayerState>;
}

/**
 * An `{msg:"audio"}` query answer.
 *
 * The reply carries NO player id — `{"msg":"audio","data":{"cover":"…"}}` is
 * all there is — so the echoed `msgId` is the only thing that says which
 * request it answers. That is why every audio query the app sends carries one.
 */
export interface AudioQueryMessage {
    kind: 'audio_query';
    msgId: string;
    /** Upstream's error string, typos included ('unkown player_id'); '' on success. */
    error: string;
    /** `get_cover_url`: absolute URL, or '' when the backend has no artwork. */
    cover: string;
    /** `get_time`: seconds, or null when the reply carried no `time_elapsed`. */
    timeElapsed: number | null;
}

export interface IoChangedMessage {
    kind: 'io_changed';
    id: string;
    // Patch semantics: only present when the event carried the field (the old
    // code checked hasOwnProperty before assigning).
    state?: string;
    name?: string;
}

// Any well-formed `event` frame that is not an io_changed — the ones the app
// implements (audio_status_changed, audio_volume_changed, audio_song_changed)
// as well as the ones it does not (new_io, delete_io, modify_room…). The name
// is historical: the home store's dispatch table decides which is which, so
// the decoder does not have to grow a case per event type.
export interface UnknownEventMessage {
    kind: 'unknown_event';
    typeStr: string;
    data: unknown;
}

// Typed fallback for malformed or unrecognized frames — decode never throws.
export interface UnknownMessage {
    kind: 'unknown';
    raw: unknown;
}

export type ServerMessage =
    | LoginResultMessage
    | GetHomeMessage
    | GetStateMessage
    | AudioQueryMessage
    | IoChangedMessage
    | UnknownEventMessage
    | UnknownMessage;
