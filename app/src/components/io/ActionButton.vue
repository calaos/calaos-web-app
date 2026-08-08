<script setup lang="ts">
// An IO row's action button — Calaos's own button artwork, not a glyph in a
// box of this app's making.
//
// calaos_mobile's ItemButtonAction is a complete picture: the button face and
// its symbol are one bitmap (`button_light_on`, `button_up2`, `button_play`…),
// with `button_action_glow` flashed over it on press. This is that component,
// so a light's "on" really is the bulb-with-rays every other Calaos client
// shows, and a shutter's "up" really is Calaos's arrow.
//
// `IconButton` is still the right thing for the app's own chrome (the navbar,
// the footer, the dialogs) — those are this app's buttons and should look like
// it. These are the HOUSE's buttons, and they should look like Calaos.
//
// Two things the bitmap cannot carry, added here:
//
//  - An accessible name. The artwork is decorative (`aria-hidden`); `label` is
//    required, exactly as on IconButton, so an icon-only control is never
//    nameless.
//  - A focus ring. The glow is a press animation and fires on click; keyboard
//    focus needs its own visible state, which the bitmap has no notion of.
//
// The styled outputs (outlet, pump, heater, boiler) have no button face of
// their own in calaos_mobile: it stacks a white `ic_outlet_on/off.svg` over the
// blank `button_empty`. `overlay` is that case — the base face plus a symbol
// painted through a mask so it stays white on the dark face in both themes.

import buttonGlow from '../../assets/io/button_action_glow.png';
import MaskIcon from '../ui/MaskIcon.vue';

/** Quoted for the same reason MaskIcon quotes its mask: Vite may inline it. */
const glowImage = `url("${buttonGlow}")`;

defineProps<{
    /** Accessible name. Also the title tooltip on pointer devices. */
    label: string;
    /** Resolved URL of the calaos button face (`button_*.png`). */
    face: string;
    /** Optional monochrome symbol drawn over a blank face. */
    overlay?: string;
}>();
</script>

<template>
    <button type="button" class="action-button" :aria-label="label" :title="label">
        <img class="action-button__face" :src="face" alt="" aria-hidden="true" decoding="async" />
        <MaskIcon v-if="overlay !== undefined" class="action-button__overlay" :src="overlay" />
        <!-- calaos_mobile fades this in over 100ms and back out over 800ms on
             every press. Driven by :active here rather than by a timer: the
             row is not optimistic, so the flash is feedback that the BUTTON
             was hit, nothing more. -->
        <span
            class="action-button__glow"
            aria-hidden="true"
            :style="{ backgroundImage: glowImage }"
        />
    </button>
</template>

<style scoped>
.action-button {
    position: relative;
    display: inline-grid;
    place-items: center;
    /* 44px, the app's floor for anything a finger aims at (WCAG 2.5.5). The
       artwork is smaller than that and sits centred in it: the tap target must
       not shrink to the size of the picture. */
    inline-size: 44px;
    block-size: 44px;
    flex: none;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    border-radius: var(--radius-sm);
    /* The overlay symbol inherits this. */
    color: #ffffff;
}

.action-button > * {
    grid-area: 1 / 1;
}

.action-button__face {
    inline-size: 37px;
    block-size: 31px;
    object-fit: contain;
    transition: filter 160ms ease;
}

.action-button:hover .action-button__face {
    filter: brightness(1.25);
}

.action-button__overlay {
    /* calaos_mobile draws the overlay at 18dp inside a 37x31 face. */
    font-size: 18px;
}

.action-button__glow {
    inline-size: 37px;
    block-size: 31px;
    background-repeat: no-repeat;
    background-position: center;
    background-size: contain;
    opacity: 0;
    pointer-events: none;
    /* The slow half of calaos_mobile's SequentialAnimation: in fast, out slow. */
    transition: opacity 800ms ease;
}

.action-button:active .action-button__glow {
    opacity: 1;
    transition-duration: 100ms;
}

@media (prefers-reduced-motion: reduce) {
    .action-button__face,
    .action-button__glow {
        transition: none;
    }
}
</style>
