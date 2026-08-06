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
import AnalogOutIo from './AnalogOutIo.vue';
import LightDimmerIo from './LightDimmerIo.vue';
import LightIo from './LightIo.vue';
import LightRgbIo from './LightRgbIo.vue';
import ScenarioIo from './ScenarioIo.vue';
import ShutterIo from './ShutterIo.vue';
import ShutterSmartIo from './ShutterSmartIo.vue';
import StringInIo from './StringInIo.vue';
import TempIo from './TempIo.vue';
import UnknownIo from './UnknownIo.vue';
import VarBoolIo from './VarBoolIo.vue';
import VarIntIo from './VarIntIo.vue';
import VarStringIo from './VarStringIo.vue';
import type { GuiType, IoItem } from '../../protocol/types';

/**
 * gui_type → the component that draws it. Total, and checked to be total.
 *
 * Every wire type now has a component of its own, so `UnknownIo` appears
 * exactly once, on the `unknown` key, and `NOT_IMPLEMENTED_GUI_TYPES` — the
 * scaffolding list T10 kept while T11–T13 were outstanding — is empty. It is
 * still exported and still read by the spec, which is what makes a type
 * quietly parked on the placeholder impossible.
 */
export const IO_COMPONENTS: Record<GuiType | 'unknown', Component> = {
    temp: TempIo,
    analog_in: AnalogInIo,
    string_in: StringInIo,
    light: LightIo,
    var_bool: VarBoolIo,
    scenario: ScenarioIo,

    // T11 — the +/- pair and the dimmer slider.
    analog_out: AnalogOutIo,
    var_int: VarIntIo,
    light_dimmer: LightDimmerIo,

    // T12 — the two dialog-driven types. `VarStringIo` serves both text
    // types: one component, two wire types (see its docblock).
    light_rgb: LightRgbIo,
    var_string: VarStringIo,
    string_out: VarStringIo,

    // T13 — up / stop / down.
    shutter: ShutterIo,
    shutter_smart: ShutterSmartIo,

    // Not scaffolding: a gui_type this version has never heard of.
    unknown: UnknownIo,
};

/**
 * The keys above that are still waiting for their own component — empty now
 * that T11–T13 have landed. Kept rather than deleted: the spec cross-checks it
 * against the table, so the next gui_type to arrive has somewhere to be parked
 * that cannot be forgotten.
 */
export const NOT_IMPLEMENTED_GUI_TYPES: readonly GuiType[] = [];
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
