<script setup lang="ts">
// `light` — on, off, and the half-second it takes to believe it.
//
// Not always a lamp: an `io_style` of `outlet`, `pump`, `heater` or `boiler`
// makes this the same wire protocol wearing a different device
// (light-styles.ts, ported from calaos_mobile's `IOTypeFromString`). The row
// therefore takes its artwork from that table rather than from a bulb glyph,
// and a running pump or outlet spins the way it does in the reference client.
//
// The state icons are Calaos's own artwork, not MDI outlines: an amber bulb, a
// cyan outlet, a red boiler. They carry their palette with them (ImageIcon),
// which is why this row does not tint them.
//
// Both buttons show unconditionally, as `light.html` did and as
// calaos_mobile's IOLight.qml does. The rewrite briefly gated them on `rw` "for
// uniformity" with `var_bool.html`, which broke every light in every real
// house: the server does not send `rw` for a light at all, so the flag was
// always false and the row never offered anything to press. See
// docs/ARCHITECTURE.md "The `rw` flag".
//
// Nothing is optimistic: the icon only changes when the server says so, and
// the dot on the glyph covers the wait. That is the store's decision
// (`sendSetState` records pending rather than writing the state), because a
// light that lights up on tap and goes dark a second later is worse than one
// that takes a second.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { resolveLightStyle } from './light-styles';
import IoRowFrame from './IoRowFrame.vue';
import { iconPowerOff, iconPowerOn } from './action-icons';
import IconButton from '../ui/IconButton.vue';
import ImageIcon from '../ui/ImageIcon.vue';
import MaskIcon from '../ui/MaskIcon.vue';
import StateIcon from '../ui/StateIcon.vue';
import { useIo } from '../../composables/useIo';
import { ACTION_FALSE, ACTION_TRUE, parseLight } from '../../protocol/io-states';
import type { IoItem } from '../../protocol/types';

const props = defineProps<{ io: IoItem }>();

const { t } = useI18n();
// A getter, not the raw string: the row is re-used across route changes and
// the id it watches must follow the prop.
const { isPending, set } = useIo(() => props.io.id);

const on = computed(() => parseLight(props.io.state).on);
const style = computed(() => resolveLightStyle(props.io.ioStyle));
</script>

<template>
    <IoRowFrame :name="io.name" :status="io.status" :pending="isPending">
        <template #icon>
            <StateIcon
                :on="on"
                :label="t(on ? 'io.on' : 'io.off')"
                class="light-io__state"
                :class="{ 'light-io__state--spinning': on && style.spins }"
            >
                <template #off><ImageIcon :src="style.imageOff" /></template>
                <template #on>
                    <!-- The pump's lit artwork is its rotor alone, so the pump
                         body sits still behind it while the rotor turns —
                         calaos_mobile nests the two the same way. -->
                    <span class="light-io__stack">
                        <ImageIcon
                            v-if="style.imageBackdrop !== undefined"
                            class="light-io__backdrop"
                            :src="style.imageBackdrop"
                        />
                        <ImageIcon class="light-io__live" :src="style.imageOn" />
                    </span>
                </template>
            </StateIcon>
        </template>

        <template #actions>
            <IconButton :label="t('io.turnOn', { name: io.name })" @click="set(ACTION_TRUE)">
                <MaskIcon :src="iconPowerOn" />
            </IconButton>
            <IconButton :label="t('io.turnOff', { name: io.name })" @click="set(ACTION_FALSE)">
                <MaskIcon :src="iconPowerOff" />
            </IconButton>
        </template>
    </IoRowFrame>
</template>

<style scoped>
/* Backdrop and moving part share one cell, so the pair occupies exactly the
   space of a single glyph. */
.light-io__stack {
    display: grid;
    place-items: center;
}

.light-io__stack > * {
    grid-area: 1 / 1;
}

/* A pump and an outlet turn while they run, as they do in calaos_mobile
   (RotationAnimation, 1s, infinite). Only the lit layer spins — the resting
   artwork must sit still, or an "off" row looks busy, and a pump whose BODY
   rotated would look like a washing machine. */
.light-io__state--spinning :deep(.light-io__live) {
    animation: light-io-spin 1000ms linear infinite;
}

/* Types with no backdrop have no inner wrapper to target, so the layer itself
   is the thing that turns. */
.light-io__state--spinning :deep(.state-icon__glyph--on > .image-icon) {
    animation: light-io-spin 1000ms linear infinite;
}

@keyframes light-io-spin {
    from {
        transform: rotate(0deg);
    }
    to {
        transform: rotate(360deg);
    }
}

@media (prefers-reduced-motion: reduce) {
    .light-io__state--spinning :deep(.light-io__live),
    .light-io__state--spinning :deep(.state-icon__glyph--on > .image-icon) {
        animation: none;
    }
}
</style>
