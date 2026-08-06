<script setup lang="ts">
// A range input that reports ONE value per interaction, not one per pixel.
//
// The old dimmer bound `ng-mouseup` straight to the slider (src/views/io/
// light_dimmer.html), which only ever worked with a mouse: a touchscreen wall
// panel — Calaos's actual target hardware — does not fire `mouseup` on its
// own, only whichever compatibility event the browser bothers synthesizing
// after a touch. Pointer Events replace that: `pointerup` fires for mouse,
// pen and touch alike, so one listener covers all three.
//
// Dragging still moves the thumb — that is the input's native behaviour,
// `@input` firing on every step — but nothing is SENT until the interaction
// ends. A keyboard user never fires `pointerdown` at all; their arrow-key
// nudge produces `input` then the browser's own `change` synchronously, so
// `change` is the keyboard path's "release". Both paths must commit EXACTLY
// once, which is the reason a pointer release suppresses the `change` that
// follows it: the browser fires both `pointerup` and `change` for the same
// mouse/touch gesture, and without the flag this component would send the
// same value twice.

import { ref, watch } from 'vue';

const props = withDefaults(
    defineProps<{
        /** The server-confirmed value. Resyncs the thumb when nothing is dragging it. */
        modelValue: number;
        min?: number;
        max?: number;
        step?: number;
        /** Accessible name — this is a bare `<input type="range">`, unlabelled otherwise. */
        label: string;
    }>(),
    { min: 0, max: 100, step: 1 },
);

const emit = defineEmits<{
    /** The final value, sent once per interaction — pointer release or keyboard change. */
    commit: [value: number];
}>();

// The thumb's own position: starts at, and resyncs to, `modelValue`, except
// mid-interaction, when an unrelated prop update (someone else's io_changed
// echoing back) must not yank the thumb out from under a pointer still
// moving it.
const live = ref(props.modelValue);
let interacting = false;
// Where the thumb sat when the pointer went down. The browser only fires
// `change` after a gesture if the value actually moved, so this is what
// decides whether a release must suppress the echo that follows it.
let sessionStart = 0;
// Set the instant a MOVING pointer release commits, so the `change` the
// browser fires immediately after is read as that same gesture's echo, not a
// second interaction to commit again. Never armed for a no-move tap: no
// `change` follows one, and a flag left armed would eat the next keyboard
// commit instead.
let suppressNextChange = false;

watch(
    () => props.modelValue,
    (value) => {
        if (!interacting) live.value = value;
    },
);

function onPointerDown() {
    interacting = true;
    sessionStart = live.value;
    // A stale flag from any earlier edge case must not survive into this
    // interaction.
    suppressNextChange = false;
}

function onInput(event: Event) {
    live.value = Number((event.target as HTMLInputElement).value);
}

function onPointerUp() {
    if (!interacting) return;
    interacting = false;
    // Nothing moved: no frame to send, and no `change` will follow.
    if (live.value === sessionStart) return;
    suppressNextChange = true;
    emit('commit', live.value);
}

function onChange() {
    if (suppressNextChange) {
        suppressNextChange = false;
        return;
    }
    // No pointer session was open: a keyboard-driven commit.
    interacting = false;
    emit('commit', live.value);
}
</script>

<template>
    <input
        type="range"
        class="base-slider"
        :min="min"
        :max="max"
        :step="step"
        :value="live"
        :aria-label="label"
        @input="onInput"
        @pointerdown="onPointerDown"
        @pointerup="onPointerUp"
        @change="onChange"
    />
</template>

<style scoped>
.base-slider {
    appearance: none;
    -webkit-appearance: none;
    inline-size: 100%;
    /* 44px of grabbable height for a 4px rail: the box is the tap target, the
       track is only what you see. Both browser engines centre the runnable
       track in the box, so growing the box does not move the rail. */
    block-size: 2.75rem;
    background: transparent;
    cursor: pointer;
}

.base-slider::-webkit-slider-runnable-track {
    block-size: 0.25rem;
    border-radius: var(--radius-sm);
    background: var(--c-track);
}

.base-slider::-moz-range-track {
    block-size: 0.25rem;
    border-radius: var(--radius-sm);
    background: var(--c-track);
}

.base-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    inline-size: 1rem;
    block-size: 1rem;
    margin-block-start: -0.375rem;
    border-radius: 50%;
    background: var(--c-accent);
    box-shadow: 0 0 6px var(--c-accent-glow);
}

.base-slider::-moz-range-thumb {
    inline-size: 1rem;
    block-size: 1rem;
    border: 0;
    border-radius: 50%;
    background: var(--c-accent);
    box-shadow: 0 0 6px var(--c-accent-glow);
}
</style>
