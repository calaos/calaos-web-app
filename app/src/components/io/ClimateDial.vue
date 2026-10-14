<script setup lang="ts">
// The dial: a 300° arc almost closed at the bottom. A neutral track, the
// stretch up to the setpoint in the colour of what the device is doing, a
// round knob on the setpoint and a white mark for the room's temperature. In
// `auto` the arc carries two knobs. The setpoint itself is never inside the
// arc: it is read below it, between − and +.
//
// Decorative for assistive technology — every number it draws is also text
// elsewhere. The default slot is centred in the arc.

import { computed } from 'vue';
import { ARC_START, PAINT, angleOf, arcPath, layout, polar, TRACK_PATH } from './climate-dial';
import type { DialPaint } from '../../protocol/climate';
import type { DeviceTargetTemp } from '../../protocol/types';

const props = withDefaults(
    defineProps<{
        size?: number;
        stroke?: number;
        knob?: number;
        /** The row's glyph: the room's temperature is a dot, not a mark across the track. */
        mini?: boolean;
        bounds?: DeviceTargetTemp;
        /** One setpoint, or the low/high pair, or none. */
        setpoint: 'single' | 'range' | 'none';
        target?: number;
        low?: number;
        high?: number;
        current?: number;
        paint: DialPaint;
    }>(),
    { size: 280, stroke: 8, knob: 12, mini: false, bounds: undefined, target: undefined, low: undefined, high: undefined, current: undefined },
);

const geometry = computed(() => layout(props));

const track = computed(() => TRACK_PATH(geometry.value));

function path(from: number, to: number): string {
    const { cx, cy, radius } = geometry.value;
    return arcPath(cx, cy, radius, from, to);
}

const b = computed(() => props.bounds);

const fill = computed(() => {
    if (!b.value) return null;
    if (props.setpoint === 'range' && props.low !== undefined && props.high !== undefined) {
        return { d: path(angleOf(props.low, b.value), angleOf(props.high, b.value)), color: PAINT[props.paint.between] };
    }
    if (props.setpoint === 'single' && props.target !== undefined) {
        return { d: path(ARC_START, angleOf(props.target, b.value)), color: PAINT[props.paint.fill] };
    }
    return null;
});

const knobs = computed(() => {
    const bounds = b.value;
    if (!bounds) return [];
    const { cx, cy, radius } = geometry.value;
    const at = (temp: number, color: string) => ({ ...polar(cx, cy, radius, angleOf(temp, bounds)), color });
    if (props.setpoint === 'range' && props.low !== undefined && props.high !== undefined) {
        return [at(props.low, PAINT[props.paint.ends[0]]), at(props.high, PAINT[props.paint.ends[1]])];
    }
    if (props.setpoint === 'single' && props.target !== undefined) return [at(props.target, PAINT[props.paint.knob])];
    return [];
});

const mark = computed(() => {
    if (!b.value || props.current === undefined) return null;
    const { cx, cy, radius } = geometry.value;
    const a = angleOf(props.current, b.value);
    if (props.mini) return { dot: polar(cx, cy, radius, a), r: Math.max(1.5, props.stroke * 0.45) };
    return { from: polar(cx, cy, radius - props.stroke * 1.3, a), to: polar(cx, cy, radius + props.stroke * 1.3, a) };
});
</script>

<template>
    <div class="climate-dial" :class="{ 'climate-dial--mini': mini }" :style="{ inlineSize: `${size}px`, blockSize: `${geometry.height}px` }">
        <svg
            class="climate-dial__svg"
            :width="size"
            :height="geometry.height"
            :viewBox="`0 0 ${size} ${geometry.height}`"
            aria-hidden="true"
            focusable="false"
        >
            <path class="climate-dial__track" :d="track" :stroke-width="stroke" />
            <path v-if="fill" class="climate-dial__fill" :d="fill.d" :stroke-width="stroke" :style="{ stroke: fill.color }" />
            <template v-if="mark">
                <circle v-if="mark.dot" class="climate-dial__mark" :cx="mark.dot.x" :cy="mark.dot.y" :r="mark.r" />
                <line
                    v-else-if="mark.from && mark.to"
                    class="climate-dial__mark"
                    :x1="mark.from.x"
                    :y1="mark.from.y"
                    :x2="mark.to.x"
                    :y2="mark.to.y"
                />
            </template>
            <circle
                v-for="(k, i) in knobs"
                :key="i"
                class="climate-dial__knob"
                :cx="k.x"
                :cy="k.y"
                :r="knob"
                :style="{ fill: k.color }"
            />
        </svg>
        <div v-if="$slots.default" class="climate-dial__inner" :style="{ top: `${geometry.cy}px` }">
            <slot />
        </div>
    </div>
</template>

<style scoped>
.climate-dial {
    position: relative;
    display: block;
    flex: none;
    margin-inline: auto;
}

.climate-dial--mini {
    margin-inline: 0;
}

.climate-dial__svg {
    display: block;
}

.climate-dial__track,
.climate-dial__fill {
    fill: none;
    stroke-linecap: round;
}

.climate-dial__track {
    stroke: var(--c-border);
}

.climate-dial__mark {
    stroke: #fff;
    stroke-width: 2;
    stroke-linecap: round;
    fill: #fff;
}

.climate-dial__mark:is(circle) {
    stroke: none;
}

/* The ring that separates a knob from the arc it sits on: the surface colour
   the dial is drawn on (the row, or the panel). */
.climate-dial__knob {
    stroke: var(--c-surface);
    stroke-width: 2;
}

.climate-dial--mini .climate-dial__knob {
    stroke-width: 1;
}

.climate-dial__inner {
    position: absolute;
    inset-inline: 0;
    transform: translateY(-50%);
    text-align: center;
    pointer-events: none;
}
</style>
