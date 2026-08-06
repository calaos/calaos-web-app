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
    gui_style?: string;
    state?: string;
    visible?: string;
    rw?: string;
    unit?: string;
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

interface IoBase {
    id: string;
    name: string;
    // Raw wire state string, parsed on demand by io-states.ts.
    state: string;
    // Converted from the wire strings 'true'/'false' at ingest (guards.ts).
    visible: boolean;
    rw: boolean;
    unit: string;
    // '' when the server did not send gui_style; io-states.ts falls back to
    // the 'default' icon (old templates: gui_style === undefined ? 'default').
    guiStyle: string;
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

// Minimal for now — the real audio protocol is researched in T16 and this
// type grows there (status, volume, current_track, ...).
export interface AudioPlayerItem {
    id: string;
    name: string;
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

export interface IoChangedMessage {
    kind: 'io_changed';
    id: string;
    // Patch semantics: only present when the event carried the field (the old
    // code checked hasOwnProperty before assigning).
    state?: string;
    name?: string;
}

// Well-formed event frame whose type_str the app does not implement yet
// (new_io, delete_io, modify_room, new_room, delete_room, audio_*...). The
// home store's dispatch table logs/stubs these.
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
    | IoChangedMessage
    | UnknownEventMessage
    | UnknownMessage;
