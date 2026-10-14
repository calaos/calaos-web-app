import type { Component } from 'vue';
import IconAuto from '~icons/mdi/swap-vertical';
import IconCool from '~icons/mdi/snowflake';
import IconDry from '~icons/mdi/water-outline';
import IconFan from '~icons/mdi/fan';
import IconHeat from '~icons/mdi/fire';
import IconOff from '~icons/mdi/power';
import IconUnknown from '~icons/mdi/help-circle-outline';

/** One glyph per mode; '' is the mode the server has not told us yet. */
export const MODE_ICONS: Record<string, Component> = {
    off: IconOff,
    heat: IconHeat,
    cool: IconCool,
    auto: IconAuto,
    dry: IconDry,
    fan_only: IconFan,
    '': IconUnknown,
};
