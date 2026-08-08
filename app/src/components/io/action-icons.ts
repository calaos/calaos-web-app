// Calaos's own action glyphs, shared by the rows that command a circuit.
//
// calaos_mobile gives `light`, `light_dimmer` and `light_rgb` the SAME pair of
// buttons (`button_light_on` / `button_light_off` in IOLight.qml,
// IOLightDimmer.qml and IOLightRGB.qml) and gives its styled outputs — outlet,
// pump, heater, boiler — the SVG pair below. One pair is used for all of them
// here: the three light types differ in what they draw as a STATE, never in
// what "on" and "off" mean, and two spellings of the same verb in one room is
// the inconsistency the old app was full of.
//
// They are monochrome, so they are painted through `MaskIcon` and follow the
// button's colour, hover and focus like every other glyph in the app. The
// files come from calaos/calaos_mobile (both projects are Calaos GPL).

import iconPowerOff from '../../assets/io/ic_outlet_off.svg';
import iconPowerOn from '../../assets/io/ic_outlet_on.svg';

export { iconPowerOff, iconPowerOn };
