<script setup lang="ts">
// Two glyphs in one square, crossfading on state.
//
// This is the old app's `label.checkbox` sprite trick (src/styles/main.css)
// rebuilt on SVG. The original stacked two `:before`/`:after` pseudo-elements
// carrying `icon_light_off.png` / `icon_light_on.png` and animated their
// opacity over .5s when a disabled checkbox flipped — a checkbox that existed
// ONLY to hold a boolean for CSS to read, which is why it had to be disabled
// and why screen readers found an unlabelled form control in every row.
//
// Kept: the two stacked layers and the half-second crossfade. That slowness is
// the point — a lamp does not snap on, and the fade is what tells you the
// server answered rather than the button merely being pressed.
//
// Changed: no form control, no bitmaps. The layers are the two icon components
// the caller passes in, and the accessible name is a real one — `label` turns
// the pair into a single `role="img"` announcing "On"/"Off"; without it the
// whole thing is decoration, for rows that say their state in text anyway.
//
// Colour is the app's rule for glyphs (HomeView's tiles): muted at rest, the
// cyan accent plus its glow when live. Both ends are overridable through
// custom properties so a caller with a different meaning of "on" — an open
// shutter, a dimmer at 40% — can retune without reaching into these classes.

import type { Component } from 'vue';

withDefaults(
    defineProps<{
        /** Which layer is on top. */
        on: boolean;
        /**
         * Glyph for the resting state (outline, in the MDI pairs used here).
         * Omit and use the `off` SLOT instead when the layer is artwork rather
         * than a glyph — `LightIo` does, to show Calaos's own device pictures.
         */
        iconOff?: Component;
        /** Glyph for the live state (filled). Or the `on` slot. */
        iconOn?: Component;
        /**
         * Accessible name for the CURRENT state ("On" / "Off"). Omit when the
         * row already spells the state out in text — then this is decoration
         * and is hidden from assistive tech instead of announced twice.
         */
        label?: string;
    }>(),
    { iconOff: undefined, iconOn: undefined, label: undefined },
);
</script>

<template>
    <span
        class="state-icon"
        :class="{ 'state-icon--on': on }"
        :role="label === undefined ? undefined : 'img'"
        :aria-label="label"
        :aria-hidden="label === undefined ? 'true' : undefined"
    >
        <span class="state-icon__glyph state-icon__glyph--off">
            <slot name="off"><component :is="iconOff" /></slot>
        </span>
        <span class="state-icon__glyph state-icon__glyph--on">
            <slot name="on"><component :is="iconOn" /></slot>
        </span>
    </span>
</template>

<style scoped>
.state-icon {
    /* One grid cell holding both layers, so the pair takes exactly the space
       of one glyph and inherits its size from the parent's font-size. */
    display: inline-grid;
    place-items: center;
    line-height: 0;
}

.state-icon__glyph {
    grid-area: 1 / 1;
    /* A wrapper now, so the layer can hold either an MDI component or a slot
       full of artwork; `grid` keeps it exactly the size of what it holds. */
    display: grid;
    place-items: center;
    transition: opacity 500ms ease;
}

.state-icon__glyph--off {
    color: var(--state-icon-off-color, var(--c-text-muted));
    opacity: 1;
}

.state-icon__glyph--on {
    color: var(--state-icon-on-color, var(--c-accent));
    /* The filament: the same glow the room header and the footer's active tab
       carry, on the one object in the row that is actually alight. */
    filter: drop-shadow(0 0 8px var(--state-icon-on-glow, var(--c-accent-glow)));
    opacity: 0;
}

.state-icon--on .state-icon__glyph--off {
    opacity: 0;
}

.state-icon--on .state-icon__glyph--on {
    opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
    .state-icon__glyph {
        transition: none;
    }
}
</style>
