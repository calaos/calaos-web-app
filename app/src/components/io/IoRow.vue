<script lang="ts">
// One IO, whichever kind it is.
//
// The old app dispatched with a fifteen-branch `ng-switch` inlined in
// `src/views/room.html`, so adding a type meant editing the room screen and
// the type list was something you reconstructed by reading markup. Here the
// dispatch is a table keyed by the discriminant of `IoItem`, and it is
// exhaustive by TYPE: `Record<GuiType | 'unknown', Component>` will not
// compile with an entry missing, so a new gui_type in `protocol/types.ts`
// breaks the build here rather than falling silently through to a default.
//
// This table is the ONLY place a gui_type is mapped to a component.

import type { Component } from 'vue';
import AnalogInIo from './AnalogInIo.vue';
import LightIo from './LightIo.vue';
import ScenarioIo from './ScenarioIo.vue';
import StringInIo from './StringInIo.vue';
import TempIo from './TempIo.vue';
import UnknownIo from './UnknownIo.vue';
import VarBoolIo from './VarBoolIo.vue';
import type { GuiType, IoItem } from '../../protocol/types';

/**
 * gui_type → the component that draws it. Total, and checked to be total.
 *
 * The `UnknownIo` entries below are scaffolding, not decisions: those types
 * are known and supported by the protocol layer already, but their controls
 * land in later tasks (see `NOT_IMPLEMENTED_GUI_TYPES`). Until then they get a
 * row that shows the name and the raw state and offers no action.
 *
 * Swapping one in is a two-line change: import the new component, point its
 * key at it, and drop the key from `NOT_IMPLEMENTED_GUI_TYPES`.
 */
export const IO_COMPONENTS: Record<GuiType | 'unknown', Component> = {
    temp: TempIo,
    analog_in: AnalogInIo,
    string_in: StringInIo,
    light: LightIo,
    var_bool: VarBoolIo,
    scenario: ScenarioIo,

    // T11 — the +/- pair and the dimmer/colour controls.
    analog_out: UnknownIo,
    var_int: UnknownIo,
    light_dimmer: UnknownIo,
    light_rgb: UnknownIo,

    // T12 — the text dialog.
    var_string: UnknownIo,
    string_out: UnknownIo,

    // T13 — up / stop / down.
    shutter: UnknownIo,
    shutter_smart: UnknownIo,

    // Not scaffolding: a gui_type this version has never heard of.
    unknown: UnknownIo,
};

/**
 * The keys above that are still waiting for their own component. Shrinks to
 * `[]` as T11–T13 land; the spec reads it, so a table entry and this list can
 * never disagree.
 */
export const NOT_IMPLEMENTED_GUI_TYPES: readonly GuiType[] = [
    'analog_out',
    'var_int',
    'light_dimmer',
    'light_rgb',
    'var_string',
    'string_out',
    'shutter',
    'shutter_smart',
];
</script>

<script setup lang="ts">
import { computed } from 'vue';

// `visible` is NOT checked here: RoomView filters invisible IOs out of the
// list before this component ever exists, because "never rendered" is a
// property of the list, not of the row (docs/ARCHITECTURE.md). `rw` is the
// opposite — it hides controls inside a row that still shows its state — and
// each component applies it to its own actions.
const props = defineProps<{ io: IoItem }>();

const component = computed(() => IO_COMPONENTS[props.io.guiType]);
</script>

<template>
    <component :is="component" :io="io" />
</template>
