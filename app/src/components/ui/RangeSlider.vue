<script setup lang="ts">
// Two handles on one rail: a low and a high bound that cannot get closer than
// `bounds.minRange`.
//
// Built from two native range inputs rather than a custom widget, so both
// thumbs are real, tab-reachable, arrow-key-operable sliders with their own
// accessible name. The inputs are stacked and only their thumbs take pointer
// events, which is what lets two sliders share one rail.
//
// Like BaseSlider, nothing is committed per tick: `live` follows the drag,
// `commit` fires on the browser's `change` (release, or one keyboard step).
// The gap is enforced here as well as by the server because the server refuses
// a too-narrow pair whole, which would look like a dead control.

import { computed, ref, watch } from 'vue';
import { moveRangeHandle } from '../../protocol/climate';
import type { Range } from '../../protocol/climate';
import type { DeviceTargetTemp } from '../../protocol/types';

const props = defineProps<{
    low: number;
    high: number;
    bounds: DeviceTargetTemp;
    labelLow: string;
    labelHigh: string;
    disabled?: boolean;
}>();

const emit = defineEmits<{
    commit: [range: Range];
    /** The pair on every drag tick, `null` once the interaction ends. */
    live: [range: Range | null];
}>();

const current = ref<Range>({ low: props.low, high: props.high });
let interacting = false;

watch(
    () => [props.low, props.high] as const,
    ([low, high]) => {
        if (!interacting) current.value = { low, high };
    },
);

function onInput(which: keyof Range, event: Event) {
    const input = event.target as HTMLInputElement;
    const next = moveRangeHandle(which, Number(input.value), current.value, props.bounds);
    current.value = next;
    // Pull the thumb back when the gap stopped it, or it would sit past the
    // other handle while the model says otherwise.
    input.value = String(next[which]);
    emit('live', next);
}

function onPress() {
    interacting = true;
}

// A tap that moves nothing fires no `change`, so the release must end the
// interaction by itself or the thumbs would never resync again.
function onRelease() {
    interacting = false;
    emit('live', null);
}

function onChange() {
    onRelease();
    emit('commit', current.value);
}

function percent(value: number): number {
    const { min, max } = props.bounds;
    return max > min ? ((value - min) / (max - min)) * 100 : 0;
}

const fill = computed(() => ({
    '--from': String(percent(current.value.low) / 100),
    '--to': String(percent(current.value.high) / 100),
}));

// When both thumbs pile up at the top of the rail the low one must be on top,
// or it could never be dragged back down.
const lowOnTop = computed(() => percent(current.value.low) > 50);

function valueText(value: number): string {
    return props.bounds.unit === '' ? String(value) : `${value} ${props.bounds.unit}`;
}
</script>

<template>
    <div class="range-slider" :style="fill">
        <span class="range-slider__rail" aria-hidden="true" />
        <span class="range-slider__fill" aria-hidden="true" />
        <input
            type="range"
            class="range-slider__input"
            :class="{ 'range-slider__input--top': lowOnTop }"
            :min="bounds.min"
            :max="bounds.max"
            :step="bounds.step"
            :value="current.low"
            :aria-label="labelLow"
            :disabled="disabled"
            :aria-valuetext="valueText(current.low)"
            @pointerdown="onPress"
            @pointerup="onRelease"
            @pointercancel="onRelease"
            @input="onInput('low', $event)"
            @change="onChange"
        />
        <input
            type="range"
            class="range-slider__input"
            :min="bounds.min"
            :max="bounds.max"
            :step="bounds.step"
            :value="current.high"
            :aria-label="labelHigh"
            :disabled="disabled"
            :aria-valuetext="valueText(current.high)"
            @pointerdown="onPress"
            @pointerup="onRelease"
            @pointercancel="onRelease"
            @input="onInput('high', $event)"
            @change="onChange"
        />
    </div>
</template>

<style scoped>
.range-slider {
    --thumb: 2rem;
    position: relative;
    inline-size: 100%;
    block-size: 2.75rem;
}

.range-slider__rail,
.range-slider__fill {
    position: absolute;
    inset-block-start: calc(50% - 0.125rem);
    block-size: 0.25rem;
    border-radius: var(--radius-sm);
}

.range-slider__rail {
    inset-inline: calc(var(--thumb) / 2);
    background: var(--c-track);
}

.range-slider__fill {
    /* The thumb centre travels (100% - thumb) of the box; the fill follows it. */
    inset-inline-start: calc(var(--thumb) / 2 + var(--from) * (100% - var(--thumb)));
    inset-inline-end: calc(var(--thumb) / 2 + (1 - var(--to)) * (100% - var(--thumb)));
    background: var(--c-accent);
}

.range-slider__input {
    position: absolute;
    inset: 0;
    inline-size: 100%;
    block-size: 100%;
    margin: 0;
    appearance: none;
    -webkit-appearance: none;
    background: transparent;
    /* Only the thumbs are grabbable: the two inputs overlap everywhere else. */
    pointer-events: none;
}

.range-slider__input--top {
    z-index: 1;
}

.range-slider__input:focus-visible {
    outline: none;
}

.range-slider__input::-webkit-slider-runnable-track {
    background: transparent;
}

.range-slider__input::-moz-range-track {
    background: transparent;
}

/* A 2rem hit area around a 1rem dot: the transparent border is the finger's
   margin, `padding-box` keeps the paint inside it. */
.range-slider__input::-webkit-slider-thumb {
    -webkit-appearance: none;
    box-sizing: border-box;
    inline-size: var(--thumb);
    block-size: var(--thumb);
    border: 0.5rem solid transparent;
    border-radius: 50%;
    background: var(--c-accent);
    background-clip: padding-box;
    filter: drop-shadow(0 0 4px var(--c-accent-glow));
    pointer-events: auto;
    cursor: pointer;
}

.range-slider__input::-moz-range-thumb {
    box-sizing: border-box;
    inline-size: var(--thumb);
    block-size: var(--thumb);
    border: 0.5rem solid transparent;
    border-radius: 50%;
    background: var(--c-accent);
    background-clip: padding-box;
    filter: drop-shadow(0 0 4px var(--c-accent-glow));
    pointer-events: auto;
    cursor: pointer;
}

.range-slider__input:focus-visible::-webkit-slider-thumb {
    outline: 2px solid var(--c-accent);
    outline-offset: -2px;
}

.range-slider__input:focus-visible::-moz-range-thumb {
    outline: 2px solid var(--c-accent);
    outline-offset: -2px;
}

.range-slider__input:disabled::-webkit-slider-thumb {
    pointer-events: none;
    cursor: default;
}

.range-slider__input:disabled::-moz-range-thumb {
    pointer-events: none;
    cursor: default;
}
</style>
