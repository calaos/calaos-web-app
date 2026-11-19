<!--
    One day of one direction, 0 to 24 h, read-only. A block shows its
    temperature only when it is wide enough to hold it.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { DAY_MINUTES, effectiveDay, setpointOf } from '../../protocol/schedule';
import type { DirectionProgram } from '../../protocol/schedule';

const props = defineProps<{
    program: DirectionProgram;
    day: number;
    /** Text for the time outside every slot ("Default 19°" or "Off"). */
    gapLabel?: string;
    /** Minutes since midnight when this track is today, for the marker. */
    now?: number;
    label: string;
    /** A period to ring (minutes, same day): the one being edited. */
    mark?: { start: number; end: number };
}>();

const { t, locale } = useI18n();

/** Text fits by pixels once the track is measured; before that (and in jsdom) by share of the day. */
const MIN_TEXT_PX = 46;
const MIN_TEXT_PERCENT = 6;

const root = ref<HTMLElement | null>(null);
const trackPx = ref(0);
let observer: ResizeObserver | undefined;
onMounted(() => {
    if (root.value === null || typeof ResizeObserver === 'undefined') return;
    observer = new ResizeObserver(() => (trackPx.value = root.value?.clientWidth ?? 0));
    observer.observe(root.value);
});
onBeforeUnmount(() => observer?.disconnect());

const pieces = computed(() =>
    effectiveDay(props.program, props.day).map((p) => {
        const width = ((p.end - p.start) / DAY_MINUTES) * 100;
        const setpoint = p.level === null ? undefined : setpointOf(props.program, p.level);
        const degrees = setpoint === undefined ? '–' : formatDegrees(setpoint);
        const fits = trackPx.value > 0 ? (width / 100) * trackPx.value >= MIN_TEXT_PX : width >= MIN_TEXT_PERCENT;
        return {
            ...p,
            left: (p.start / DAY_MINUTES) * 100,
            width,
            fits,
            text: p.level === null ? (props.gapLabel ?? '') : `${degrees}°`,
        };
    }),
);

function formatDegrees(value: number): string {
    return value.toLocaleString(locale.value, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

const kind = computed(() => (props.program.direction === 'heat' ? 'h' : 'c'));
/** First level whose fill takes white text: black stays above 4.5:1 up to there, white from there on. */
const lightFrom = computed(() => (props.program.direction === 'heat' ? 6 : 5));
</script>

<template>
    <div ref="root" class="track" role="group" :aria-label="label">
        <template v-for="p in pieces" :key="`${p.start}-${p.level}`">
            <div
                v-if="p.level !== null"
                class="track__seg"
                :class="{ 'track__seg--light': p.level >= lightFrom }"
                :style="{ left: `${p.left}%`, width: `${p.width}%`, background: `var(--lv-${kind}${p.level})` }"
                aria-hidden="true"
            >
                <span v-if="p.fits && p.text">{{ p.text }}</span>
            </div>
            <div v-else class="track__gap" :style="{ left: `${p.left}%`, width: `${p.width}%` }" aria-hidden="true">
                <span v-if="p.fits && p.text">{{ p.text }}</span>
            </div>
        </template>
        <div
            v-if="mark"
            class="track__mark"
            :style="{ left: `${(mark.start / DAY_MINUTES) * 100}%`, width: `${((mark.end - mark.start) / DAY_MINUTES) * 100}%` }"
            aria-hidden="true"
        />
        <div v-if="now !== undefined" class="track__now" :style="{ left: `${(now / DAY_MINUTES) * 100}%` }" :title="t('schedule.now')" aria-hidden="true" />
    </div>
</template>

<style scoped>
.track {
    position: relative;
    block-size: 1.75rem;
    /* The gap label is muted text: --c-track (slider rails) would leave it at 1.9:1. */
    background: var(--c-surface-raised);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--radius-sm);
    overflow: hidden;
}

.track__seg,
.track__gap {
    position: absolute;
    inset-block: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    overflow: hidden;
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
    border: 0;
}

.track__gap span {
    /* A flex-centred label that overflows is cut on both sides: ellipsis keeps its start. */
    min-inline-size: 0;
    padding-inline: var(--space-1);
    overflow: hidden;
    text-overflow: ellipsis;
}

.track__seg {
    color: var(--c-on-level-dark);
    border-inline: 1px solid var(--c-surface);
}

.track__seg--light {
    color: var(--c-on-level-light);
}

.track__gap {
    font-weight: 400;
    color: var(--c-text-muted);
}

.track__mark {
    position: absolute;
    inset-block: 0;
    border: 2px solid var(--c-text);
    border-radius: var(--radius-sm);
    pointer-events: none;
}

.track__now {
    position: absolute;
    inset-block: 0;
    inline-size: 2px;
    margin-inline-start: -1px;
    /* Ticks at both ends only: a full-height line would cut the centred label of
       the segment under it (the first letter of "Default"). */
    background: linear-gradient(to bottom, var(--c-text) 0 22%, transparent 22% 78%, var(--c-text) 78% 100%);
    pointer-events: none;
}
</style>
