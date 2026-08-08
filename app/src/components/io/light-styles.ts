// `light` + `io_style` → which device this actually is.
//
// A calaos `light` is not always a lamp. calaos_server lets an output declare
// an `io_style`, and calaos_mobile turns that into a different row entirely
// (src/Common.cpp, `IOTypeFromString`):
//
//     light + "pump"    -> Pump        (IOPump.qml)
//     light + "outlet"  -> Outlet      (IOOutlet.qml)
//     light + "boiler"  -> Boiler      (IOBoiler.qml)
//     light + "heater"  -> Heater      (IOHeater.qml)
//     light             -> Light       (IOLight.qml)
//
// The rewrite drew all five as a bulb, so a heating circuit and a water pump
// both looked like someone had left a lamp on. Same artwork as the reference
// client is used here (app/src/assets/io/, copied from calaos/calaos_mobile —
// both projects are Calaos GPL), so a house looks like itself in either app.
//
// The `on`/`off` verbs and the wire protocol are identical for all five: this
// only changes what the row LOOKS like, never what it sends.

import boilerOff from '../../assets/io/icon_boiler_off.svg';
import boilerOn from '../../assets/io/icon_boiler_on.svg';
import heaterOff from '../../assets/io/icon_heater_off.svg';
import heaterOn from '../../assets/io/icon_heater_on.svg';
import lightOff from '../../assets/io/icon_light_off.png';
import lightOn from '../../assets/io/icon_light_on.png';
import outletOff from '../../assets/io/icon_outlet_off.svg';
import outletOn from '../../assets/io/icon_outlet_on.svg';
import pumpBackdrop from '../../assets/io/icon_pump_bg.svg';
import pumpOff from '../../assets/io/icon_pump_off.svg';
import pumpOn from '../../assets/io/icon_pump_009.svg';

export interface LightStyleDefinition {
    /** i18n key suffix: `ioStyle.<key>`. Also the row's eyebrow label. */
    key: string;
    /** Artwork for the resting state. */
    imageOff: string;
    /** Artwork for the live state. */
    imageOn: string;
    /**
     * Does the live artwork spin? calaos_mobile rotates the pump and the
     * outlet's rotor while they run (`RotationAnimation`, 1s, infinite).
     */
    spins: boolean;
    /**
     * A still layer drawn BEHIND the live artwork, when the live artwork is
     * only the moving part.
     *
     * The pump is the case: `icon_pump_009.svg` is the rotor alone, and
     * calaos_mobile nests it inside an `IconItem` showing `icon_pump_bg` (see
     * IOPump.qml). Rendered on its own it is a small blade floating in an
     * empty box — which is exactly how it first looked here.
     */
    imageBackdrop?: string;
}

/** The lamp: what a `light` is when the server says nothing more. */
export const DEFAULT_LIGHT_STYLE: LightStyleDefinition = {
    key: 'light',
    imageOff: lightOff,
    imageOn: lightOn,
    spins: false,
};

/** Keyed by the exact `io_style` string calaos_server sends. */
export const LIGHT_STYLES: Record<string, LightStyleDefinition> = {
    outlet: { key: 'outlet', imageOff: outletOff, imageOn: outletOn, spins: true },
    pump: {
        key: 'pump',
        imageOff: pumpOff,
        imageOn: pumpOn,
        spins: true,
        imageBackdrop: pumpBackdrop,
    },
    heater: { key: 'heater', imageOff: heaterOff, imageOn: heaterOn, spins: false },
    boiler: { key: 'boiler', imageOff: boilerOff, imageOn: boilerOn, spins: false },
};

/**
 * The device a `light` really is. Total: an unknown or empty style is a lamp,
 * which is the fallthrough calaos_mobile's `IOTypeFromString` ends on.
 */
export function resolveLightStyle(ioStyle: string): LightStyleDefinition {
    return LIGHT_STYLES[ioStyle.trim().toLowerCase()] ?? DEFAULT_LIGHT_STYLE;
}
