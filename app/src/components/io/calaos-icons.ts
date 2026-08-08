// Calaos's own artwork for IO rows: the button faces and the state icons.
//
// Every entry here is the file calaos_mobile uses for the same thing, so a
// house looks like itself whichever client is in front of you. The names are
// the QML ones (`imageSource: "button_up2"`, `getPictureSized("icon_temp")`),
// which is what makes the two mappings checkable against each other.
//
// Sources, all Calaos GPL:
//   - calaos/calaos_mobile `img/` — everything below except the three noted.
//   - this repo's own AngularJS history — `icon_int`, `icon_analog`,
//     `icon_default`. calaos_mobile has no icon for a bare var_int or an
//     unstyled analog (it draws those rows as text only), but our rows all
//     carry a glyph, and the old web app's own icons are the right Calaos
//     answer rather than an MDI outline.
//
// The `@2x` variants were taken where they exist: these render at ~22-31px on
// a display that is usually hidpi.

// ---- button faces (the whole button, symbol included) ----------------------

import buttonCheck from '../../assets/io/button_check.png';
import buttonDown from '../../assets/io/button_down2.png';
import buttonEmpty from '../../assets/io/button_empty.png';
import buttonKeyboard from '../../assets/io/button_keyboard.png';
import buttonLightOff from '../../assets/io/button_light_off.png';
import buttonLightOn from '../../assets/io/button_light_on.png';
import buttonMin from '../../assets/io/button_min.png';
import buttonPlay from '../../assets/io/button_play.png';
import buttonPlus from '../../assets/io/button_plus.png';
import buttonStop from '../../assets/io/button_stop.png';
import buttonUp from '../../assets/io/button_up2.png';

// ---- symbols overlaid on the blank face ------------------------------------

import symbolPowerOff from '../../assets/io/ic_outlet_off.svg';
import symbolPowerOn from '../../assets/io/ic_outlet_on.svg';

// ---- state icons -----------------------------------------------------------

import iconAnalog from '../../assets/io/icon_analog.png';
import iconBoolOff from '../../assets/io/icon_bool_off.png';
import iconBoolOn from '../../assets/io/icon_bool_on.png';
import iconCurrent from '../../assets/io/icon_current.svg';
import iconDefault from '../../assets/io/icon_default.png';
import iconHumidity from '../../assets/io/icon_humidity.svg';
import iconInt from '../../assets/io/icon_int.png';
import iconLightOff from '../../assets/io/icon_light_off.png';
import iconLightOn from '../../assets/io/icon_light_on.png';
import iconLuminosity from '../../assets/io/icon_luminosity.svg';
import iconPressure from '../../assets/io/icon_pressure.svg';
import iconScenario from '../../assets/io/icon_scenario.png';
import iconShutterOff from '../../assets/io/icon_shutter_off.png';
import iconShutterOn from '../../assets/io/icon_shutter_on.png';
import iconSpeed from '../../assets/io/icon_speed.svg';
import iconTemp from '../../assets/io/icon_temp.png';
import iconText from '../../assets/io/icon_text.png';
import iconVoltage from '../../assets/io/icon_voltage.svg';
import iconWatt from '../../assets/io/icon_watt.svg';

export const BUTTONS = {
    /** light / light_dimmer / light_rgb — IOLight.qml and its two siblings. */
    lightOn: buttonLightOn,
    lightOff: buttonLightOff,
    /** shutter / shutter_smart — IOShutter.qml. */
    up: buttonUp,
    stop: buttonStop,
    down: buttonDown,
    /** scenario — IOScenario.qml. */
    play: buttonPlay,
    /** analog_out / var_int — IOVarInt.qml. */
    plus: buttonPlus,
    minus: buttonMin,
    /** var_bool — IOVarBool.qml uses a ticked face and a blank one. */
    check: buttonCheck,
    empty: buttonEmpty,
    /** var_string / string_out — IOVarString.qml. */
    keyboard: buttonKeyboard,
} as const;

export const SYMBOLS = {
    /** Drawn over `BUTTONS.empty` for the styled outputs (IOOutlet.qml…). */
    powerOn: symbolPowerOn,
    powerOff: symbolPowerOff,
} as const;

export const STATE_ICONS = {
    temp: iconTemp,
    /** light_dimmer / light_rgb — IOLightDimmer.qml, IOLightRGB.qml. */
    lightOn: iconLightOn,
    lightOff: iconLightOff,
    scenario: iconScenario,
    text: iconText,
    int: iconInt,
    boolOn: iconBoolOn,
    boolOff: iconBoolOff,
    shutterOn: iconShutterOn,
    shutterOff: iconShutterOff,
} as const;

/**
 * `io_style` → the glyph for an analog reading.
 *
 * calaos_mobile builds this name at runtime (IOAnalogStyled.qml:
 * `getPictureSized("icon_%1".arg(modelData.ioStyle))`, with `temperature`
 * special-cased onto `icon_temp`), so the set it supports is the set of files
 * that ship. This is that set, made explicit — a missing file there renders an
 * empty box, which is the same failure the old AngularJS app had.
 */
export const ANALOG_STYLE_ICONS: Record<string, string> = {
    temp: iconTemp,
    temperature: iconTemp,
    humidity: iconHumidity,
    luminosity: iconLuminosity,
    light: iconLuminosity,
    pressure: iconPressure,
    voltage: iconVoltage,
    current: iconCurrent,
    watt: iconWatt,
    speed: iconSpeed,
    int: iconInt,
    text: iconText,
    analog: iconAnalog,
    default: iconDefault,
};

/** The glyph for an analog style. Total — an unknown style gets the dial. */
export function resolveAnalogIcon(ioStyle: string): string {
    return ANALOG_STYLE_ICONS[ioStyle.trim().toLowerCase()] ?? ANALOG_STYLE_ICONS.default;
}
