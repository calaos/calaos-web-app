<!--
    One day of one direction, 0 to 24 h. Interactive (the editor's day track,
    44 px segments that open the slot) or a 28 px read-only preview row.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { DAY_MINUTES, effectiveDay, formatMinutes, setpointOf } from '../../protocol/schedule';
import type { DirectionProgram } from '../../protocol/schedule';

const props = defineProps<{
    program: DirectionProgram;
    day: number;
    /** Text for the time outside every slot ("Default 19°" or "Off"). */
    gapLabel: string;
    interactive?: boolean;
    /** Minutes since midnight when this track is today, for the marker. */
    now?: number;
    label: string;
}>();

const emit = defineEmits<{ open: [level: number, start: number] }>();
const { t, locale } = useI18n();

/** Text fits by pixels once the track is measured; before that (and in jsdom) by share of the day. */
const NARROW_PERCENT = 9;
const TINY_PERCENT = 5;
const NARROW_PX = 68;
const TINY_PX = 28;

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
        return {
            ...p,
            left: (p.start / DAY_MINUTES) * 100,
            width,
            narrow: trackPx.value > 0 ? (width / 100) * trackPx.value < NARROW_PX : width < NARROW_PERCENT,
            tiny: trackPx.value > 0 ? (width / 100) * trackPx.value < TINY_PX : width < TINY_PERCENT,
            text: p.level === null ? props.gapLabel : `N${p.level} ${degrees}°`,
            aria:
                p.level === null
                    ? ''
                    : t('schedule.segment', {
                          n: p.level,
                          start: formatMinutes(p.start),
                          end: formatMinutes(p.end),
                          setpoint: degrees,
                      }),
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
    <div ref="root" class="track" :class="{ 'track--preview': !interactive }" role="group" :aria-label="label">
        <template v-for="p in pieces" :key="`${p.start}-${p.level}`">
            <button
                v-if="p.level !== null && interactive"
                type="button"
                class="track__seg"
                :class="{ 'track__seg--light': p.level >= lightFrom }"
                :style="{ left: `${p.left}%`, width: `${p.width}%`, background: `var(--lv-${kind}${p.level})` }"
                :aria-label="p.aria"
                :title="p.aria"
                @click="emit('open', p.level, p.start)"
            >
                <span aria-hidden="true">{{ p.tiny ? '' : p.narrow ? `N${p.level}` : p.text }}</span>
            </button>
            <div
                v-else-if="p.level !== null"
                class="track__seg"
                :class="{ 'track__seg--light': p.level >= lightFrom }"
                :style="{ left: `${p.left}%`, width: `${p.width}%`, background: `var(--lv-${kind}${p.level})` }"
                :title="p.aria"
                aria-hidden="true"
            >
                <span>{{ p.tiny ? '' : p.narrow ? `N${p.level}` : p.text }}</span>
            </div>
            <div v-else class="track__gap" :style="{ left: `${p.left}%`, width: `${p.width}%` }" aria-hidden="true">
                <span v-if="!p.narrow">{{ p.text }}</span>
            </div>
        </template>
        <div v-if="now !== undefined" class="track__now" :style="{ left: `${(now / DAY_MINUTES) * 100}%` }" :title="t('schedule.now')" aria-hidden="true" />
    </div>
</template>

<style scoped>
.track {
    position: relative;
    block-size: 2.75rem;
    /* The gap label is muted text: --c-track (slider rails) would leave it at 1.9:1. */
    background: var(--c-surface-raised);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--radius-sm);
    overflow: hidden;
}

.track--preview {
    block-size: 1.75rem;
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
    color: #000;
    border-inline: 1px solid var(--c-surface);
}

.track__seg--light {
    color: #fff;
}

button.track__seg {
    cursor: pointer;
}

button.track__seg:focus-visible {
    z-index: 1;
    outline: 2px solid var(--c-accent);
    outline-offset: -2px;
}

.track__gap {
    font-weight: 400;
    color: var(--c-text-muted);
}

.track__now {
    position: absolute;
    inset-block: 0;
    inline-size: 2px;
    margin-inline-start: -1px;
    background: var(--c-text);
    pointer-events: none;
}
</style>
