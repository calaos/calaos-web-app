// `gui_style` → glyph, for the IO types whose icon the server chooses.
//
// The old app built an image path out of the field
// (`images/icon_{{gui_style === undefined ? 'default' : gui_style}}.png`), so
// the set of styles it actually supported is the set of files that shipped in
// `src/images/`: analog, default, humidity, int, temp, text. Anything else —
// including the `gui_style: "light"` a calaos_server can send for a lux
// sensor — resolved to a URL with no file behind it and rendered a broken
// image icon in the middle of the row.
//
// This table is that file list, one MDI glyph per entry, plus `light` (which
// the old app could only render broken) and a total fallback: an unmapped
// style lands on the default glyph rather than on nothing.
//
// `icon_default.png` and `icon_analog.png` were byte-identical in the old
// repo, so `default` and `analog` deliberately share a glyph here too.
//
// Shared because three components read it: `AnalogInIo` and `UnknownIo` today,
// `AnalogOutIo` when T11 lands (`parseAnalogOut` returns the same `icon`
// field). Pass either a raw `gui_style` or the `icon` an `io-states` parser
// already resolved — both are handled.

import type { Component } from 'vue';
import IconBrightness6 from '~icons/mdi/brightness-6';
import IconCounter from '~icons/mdi/counter';
import IconFormatText from '~icons/mdi/format-text';
import IconGauge from '~icons/mdi/gauge';
import IconThermometer from '~icons/mdi/thermometer';
import IconWaterPercent from '~icons/mdi/water-percent';

/** Every `gui_style` this app draws, keyed exactly as the server sends it. */
export const IO_STYLE_ICONS: Record<string, Component> = {
    // A dial with a needle: a measured quantity, no unit implied.
    default: IconGauge,
    analog: IconGauge,
    temp: IconThermometer,
    humidity: IconWaterPercent,
    int: IconCounter,
    text: IconFormatText,
    // New: the old app had no `icon_light.png` to serve this one.
    light: IconBrightness6,
};

/** The glyph for a style. Total — an unknown style gets the default dial. */
export function resolveIoStyleIcon(ioStyle: string): Component {
    return IO_STYLE_ICONS[ioStyle] ?? IO_STYLE_ICONS.default;
}
