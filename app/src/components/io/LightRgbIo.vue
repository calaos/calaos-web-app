<script setup lang="ts">
// `light_rgb` — a lamp that also has a colour.
//
// On and off are the same two verbs a plain `light` sends, so the row keeps
// the same two buttons and the same crossfading bulb. What is new is the
// third control, and the decision worth writing down is that it is not an
// icon: the button that opens the picker IS the swatch, a chip filled with
// the colour the lamp is currently showing. The old app had both — a
// keyboard-looking button next to a dead `<div>` painted with the colour —
// which is one element more than the row needs. A well you press to change
// what is in it is an honest control; a swatch that only looks is furniture.
//
// The bulb is retuned rather than left cyan. StateIcon's on-colour and its
// glow are custom properties precisely so a caller whose "on" means something
// other than the house accent can say so, and a magenta lamp drawn in cyan
// would be the row lying about the one thing it exists to report. When `rw`
// hides the buttons the tint is the ONLY colour left, which is the reason it
// lives on the glyph and not only on the chip.
//
// Nothing is optimistic (docs/ARCHITECTURE.md): the picker's confirm sends
// `set #rrggbb` and the row waits for `io_changed` like every other row.

import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ActionButton from './ActionButton.vue';
import { BUTTONS, STATE_ICONS } from './calaos-icons';
import IoRowFrame from './IoRowFrame.vue';
import ColorPickerDialog from '../dialogs/ColorPickerDialog.vue';
import IconButton from '../ui/IconButton.vue';
import ImageIcon from '../ui/ImageIcon.vue';
import StateIcon from '../ui/StateIcon.vue';
import { useIo } from '../../composables/useIo';
import { ACTION_FALSE, ACTION_TRUE, parseLightRgb, setColor } from '../../protocol/io-states';
import type { IoItem } from '../../protocol/types';

const props = defineProps<{ io: IoItem }>();

const { t } = useI18n();
const { isPending, set } = useIo(() => props.io.id);

const rgb = computed(() => parseLightRgb(props.io.state));

const pickerOpen = ref(false);

/** The lamp's own colour, on the glyph — but only while it is alight. */
const lampTint = computed(() =>
    rgb.value.on
        ? { '--state-icon-on-color': rgb.value.color, '--state-icon-on-glow': rgb.value.color }
        : undefined,
);

function confirmColor(hex: string): void {
    pickerOpen.value = false;
    set(setColor(hex));
}
</script>

<template>
    <IoRowFrame :name="io.name" :status="io.status" :pending="isPending">
        <template #icon>
            <StateIcon
                :on="rgb.on"
                :label="t(rgb.on ? 'io.on' : 'io.off')"
                :style="lampTint"
            >
                <template #off><ImageIcon :src="STATE_ICONS.lightOff" /></template>
                <template #on><ImageIcon :src="STATE_ICONS.lightOn" /></template>
            </StateIcon>
        </template>

        <template #actions>
            <ActionButton
                :label="t('io.turnOn', { name: io.name })"
                :face="BUTTONS.lightOn"
                @click="set(ACTION_TRUE)"
            />
            <ActionButton
                :label="t('io.turnOff', { name: io.name })"
                :face="BUTTONS.lightOff"
                @click="set(ACTION_FALSE)"
            />
            <!-- No Calaos face for this one: calaos_mobile opens its colour
                 picker from the row itself. A swatch showing the current
                 colour is the clearer control, so it keeps the app's own
                 button chrome. -->
            <IconButton :label="t('io.setColor', { name: io.name })" @click="pickerOpen = true">
                <span class="light-rgb-io__swatch" :style="{ backgroundColor: rgb.color }" />
            </IconButton>
        </template>
    </IoRowFrame>

    <!-- Renders nothing at all while closed; teleported to <body> when open. -->
    <ColorPickerDialog
        :open="pickerOpen"
        :color="rgb.color"
        :name="io.name"
        @confirm="confirmColor"
        @cancel="pickerOpen = false"
    />
</template>

<style scoped>
.light-rgb-io__swatch {
    display: block;
    inline-size: 1.25rem;
    block-size: 1.25rem;
    border-radius: 50%;
    /* A ring, always: the colour of an off lamp is black, and a black disc on
       a dark button is a hole rather than a control. */
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
}
</style>
