// Pure per-gui_type IO state parsers — FAITHFUL transcription of the old
// AngularJS logic in src/scripts/controllers/io.js and the templates in
// src/views/io/*.html. NO Vue imports in this directory.
//
// Input is always the raw wire `state` string (plus name/unit/gui_style where
// the old templates used them); output is a small plain view-model object.
// Deviations from the old code are deliberate, documented fixes listed in
// docs/ARCHITECTURE.md (numeric shutter_smart percent compare, unit fallback
// for temp, uniform rw gating handled by components — not here).

// ---------------------------------------------------------------------------
// Action verbs — the exact wire strings sent as set_state values
// (transcribed from the ng-click handlers in src/views/io/*.html).
// ---------------------------------------------------------------------------

export const ACTION_TRUE = 'true';
export const ACTION_FALSE = 'false';
export const ACTION_UP = 'up';
export const ACTION_DOWN = 'down';
export const ACTION_STOP = 'stop';
export const ACTION_INC = 'inc';
export const ACTION_DEC = 'dec';

// Dimmer slider commit (old: "set " + percent_value_rw).
export function setPercent(percent: number): string {
    return 'set ' + percent;
}

// RGB color picker confirm (old ColorPickerCtrl: "set " + color).
export function setColor(hex: string): string {
    return 'set ' + hex;
}

// var_string / string_out text dialog sends the RAW text with NO 'set '
// prefix (old StringDialogCtrl: CalaosApp.setState(item, $scope.text)).
export function setText(text: string): string {
    return text;
}

// ---------------------------------------------------------------------------
// View-model shapes
// ---------------------------------------------------------------------------

export interface DisplayState {
    display: string;
}

export interface IconDisplayState extends DisplayState {
    icon: string;
}

export interface OnOffState {
    on: boolean;
}

export interface DimmerState {
    on: boolean;
    percent: number;
}

export interface RgbState {
    on: boolean;
    color: string;
}

export interface ShutterState {
    open: boolean;
}

export type ShutterAction = 'up' | 'down' | 'stop';

export interface ShutterSmartState {
    // null when the state string matches none of the up/down/stop prefixes
    // (the old code only ever derived the open flag, never the action).
    action: ShutterAction | null;
    percent: number;
    open: boolean;
}

export interface CheckedState {
    checked: boolean;
}

export interface UnknownState {
    display: string;
    state: string;
    icon: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Old templates rendered "{{item.state}} {{item.unit}}" — join with a space
// only when there is a unit (the old trailing space was collapsed by HTML).
function joinUnit(state: string, unit: string): string {
    return unit === '' ? state : state + ' ' + unit;
}

// Old templates: icon_{{gui_style === undefined ? 'default' : gui_style}}.
// guards.ts normalizes a missing gui_style to '', so '' → 'default' (this
// also covers an empty-string gui_style, which the old app rendered as a
// broken icon_.png).
function iconStyle(ioStyle: string): string {
    return ioStyle === '' ? 'default' : ioStyle;
}

// ---------------------------------------------------------------------------
// One pure parse function per gui_type
// ---------------------------------------------------------------------------

// temp — old template hardcoded '°C'; deliberate fix: use the server unit
// when provided, '°C' as fallback.
export function parseTemp(state: string, unit: string): DisplayState {
    return { display: joinUnit(state, unit === '' ? '°C' : unit) };
}

// analog_in — value + unit, gui_style icon with 'default' fallback.
export function parseAnalogIn(state: string, unit: string, ioStyle: string): IconDisplayState {
    return { display: joinUnit(state, unit), icon: iconStyle(ioStyle) };
}

// string_in — old string_input.html used VarStringCtrl: empty state → name.
export function parseStringIn(state: string, name: string): DisplayState {
    return parseVarString(state, name);
}

// light — on ⇔ state is exactly 'true'. Actions: ACTION_TRUE / ACTION_FALSE.
export function parseLight(state: string): OnOffState {
    return { on: state === 'true' };
}

// analog_out — same display as analog_in. Actions: ACTION_INC / ACTION_DEC.
export function parseAnalogOut(state: string, unit: string, ioStyle: string): IconDisplayState {
    return { display: joinUnit(state, unit), icon: iconStyle(ioStyle) };
}

// light_dimmer — precedence transcribed VERBATIM from LightDimmerCtrl:
//   1. bare numeric state: parseInt('42') → 42. Note parseInt('set 50') is
//      NaN, so 'set ...' states fall through to the next branch.
//   2. 'set N' prefix (exactly 'set ' — 4 chars): percent = parseInt(rest).
//      'set junk' yields NaN, exactly like the old code (never sent by the
//      real server; preserved rather than papered over).
//   3. 'true' → 100, 'false' → 0, anything else → 0 (the initial value).
// on ⇔ percent > 0 (false for NaN, same as old `NaN > 0`).
// parseInt is used without a radix, as in the old code.
export function parseLightDimmer(state: string): DimmerState {
    let percent = 0;
    const direct = parseInt(state);
    if (!Number.isNaN(direct)) {
        percent = direct;
    } else if (state.substring(0, 4) === 'set ') {
        percent = parseInt(state.substring(4));
    } else if (state === 'true') {
        percent = 100;
    } else if (state === 'false') {
        percent = 0;
    }
    return { percent, on: percent > 0 };
}

// light_rgb — transcribed from LightRGBCtrl:
//   color = state === '0' ? '#000' : state
//   on ⇔ !(state === '0' || state === '#000000')
// Note the old quirk is preserved: any other string (even '') counts as on.
export function parseLightRgb(state: string): RgbState {
    return {
        color: state === '0' ? '#000' : state,
        on: !(state === '0' || state === '#000000'),
    };
}

// shutter — open ⇔ state is exactly 'true'. Actions: up / stop / down.
export function parseShutter(state: string): ShutterState {
    return { open: state === 'true' };
}

// shutter_smart — state strings are 'up <pct>', 'down <pct>', 'stop <pct>'
// (percent may be missing). Prefix matching transcribed from ShutterCtrl
// (stop → substring(5), up → substring(3), down → substring(5); no prefix →
// '0'). DELIBERATE FIX: the old code compared the raw STRING (`v < 100`,
// leaving its parseInt result unused), so an unparseable percent compared as
// NaN and showed closed. Here the percent is parseInt'd with NaN → 0 and the
// open indicator uses a NUMERIC percent < 100 compare.
export function parseShutterSmart(state: string): ShutterSmartState {
    let action: ShutterAction | null = null;
    let raw = '0';
    if (state.startsWith('stop')) {
        action = 'stop';
        raw = state.substring(5);
    } else if (state.startsWith('up')) {
        action = 'up';
        raw = state.substring(3);
    } else if (state.startsWith('down')) {
        action = 'down';
        raw = state.substring(5);
    }
    let percent = parseInt(raw);
    if (Number.isNaN(percent)) {
        percent = 0;
    }
    return { action, percent, open: percent < 100 };
}

// var_bool — checked ⇔ state is exactly 'true'. Actions: true / false.
export function parseVarBool(state: string): CheckedState {
    return { checked: state === 'true' };
}

// var_int — value + unit. Actions: ACTION_INC / ACTION_DEC.
export function parseVarInt(state: string, unit: string): DisplayState {
    return { display: joinUnit(state, unit) };
}

// var_string — transcribed from VarStringCtrl: empty state → show the IO
// name instead. The text dialog sends RAW text via setText (no prefix).
export function parseVarString(state: string, name: string): DisplayState {
    return { display: state === '' ? name : state };
}

// string_out — same display + dialog behavior as var_string.
export function parseStringOut(state: string, name: string): DisplayState {
    return parseVarString(state, name);
}

// scenario — name only. Action: ACTION_TRUE (play).
export function parseScenario(name: string): DisplayState {
    return { display: name };
}

// unknown gui_type — icon from gui_style, name + raw state. No actions.
export function parseUnknown(state: string, name: string, ioStyle: string): UnknownState {
    return { display: name, state, icon: iconStyle(ioStyle) };
}
