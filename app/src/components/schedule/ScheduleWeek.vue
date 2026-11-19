<!--
    First screen of the program dialog: the seven days as read-only bars, one
    touch target per day. Everything is edited from the day it opens.
-->
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import IconChevron from '~icons/mdi/chevron-right';
import IconPause from '~icons/mdi/pause';
import ScheduleTrack from './ScheduleTrack.vue';
import { WEEKDAYS, slotsOfDay } from '../../protocol/schedule';
import type { Direction, DirectionProgram } from '../../protocol/schedule';

const props = defineProps<{
    program: DirectionProgram;
    directions: Direction[];
    direction: Direction;
    /** ISO weekday of today and the minute of the day, for the marker. */
    today: number;
    now: number;
    paused: boolean;
    /** Text of the paused banner (setpoint the room stays at). */
    pausedText: string;
    /** The program switch can be driven from here. */
    canToggle: boolean;
    saving: boolean;
}>();

const emit = defineEmits<{ direction: [d: Direction]; day: [d: number]; toggle: [] }>();
const { t } = useI18n();

function rowLabel(d: number): string {
    const n = slotsOfDay(props.program, d).length;
    return `${t(`schedule.dayName.${d}`)}, ${t(`schedule.${props.direction}`)}, ${n === 0 ? t('schedule.v2.dayEmptyHint') : t('schedule.v2.count', { n }, n)}`;
}

function gapLabel(d: number): string {
    return slotsOfDay(props.program, d).length === 0 ? t('schedule.v2.dayEmptyHint') : '';
}

const AXIS = [0, 6, 12, 18, 24];
</script>

<template>
    <div class="week">
        <div v-if="directions.length > 1" class="week__tabs" role="tablist" :aria-label="t('schedule.tabs')">
            <button
                v-for="d in directions"
                :key="d"
                type="button"
                role="tab"
                class="week__tab"
                :aria-selected="d === direction"
                @click="emit('direction', d)"
            >
                {{ t(`schedule.${d}`) }}
            </button>
        </div>

        <div class="week__state" :class="{ 'week__state--paused': paused }" role="status">
            <template v-if="paused">
                <IconPause aria-hidden="true" />
                <span class="week__state-text">{{ pausedText }}</span>
                <button v-if="canToggle" type="button" class="week__button" :disabled="saving" @click="emit('toggle')">
                    {{ t('program.resume') }}
                </button>
            </template>
            <template v-else>
                <span class="week__dot" aria-hidden="true" />
                <span class="week__state-text">{{ t('schedule.v2.active') }}</span>
                <button v-if="canToggle" type="button" class="week__button" :disabled="saving" @click="emit('toggle')">
                    {{ t('schedule.v2.pause') }}
                </button>
            </template>
        </div>

        <ul class="week__list" :class="{ 'week__list--paused': paused }">
            <li v-for="d in WEEKDAYS" :key="d">
                <button type="button" class="week__row" :aria-label="rowLabel(d)" @click="emit('day', d)">
                    <span class="week__name" :class="{ 'week__name--today': d === today }" aria-hidden="true">{{ t(`schedule.dayShort.${d}`) }}</span>
                    <span class="week__bar" aria-hidden="true">
                        <ScheduleTrack :program="program" :day="d" :gap-label="gapLabel(d)" :now="d === today ? now : undefined" :label="t(`schedule.dayName.${d}`)" />
                    </span>
                    <IconChevron class="week__chevron" aria-hidden="true" />
                </button>
            </li>
        </ul>
        <div class="week__axis" aria-hidden="true">
            <span v-for="h in AXIS" :key="h" :style="{ left: `${(h / 24) * 100}%` }">{{ h }}</span>
        </div>
    </div>
</template>

<style scoped>
.week {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.week__tabs {
    display: flex;
    gap: var(--space-2);
}

.week__tab,
.week__button {
    min-block-size: 2.75rem;
    min-inline-size: 2.75rem;
    padding: 0 var(--space-4);
    font: inherit;
    color: var(--c-text);
    background: var(--c-surface-raised);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    cursor: pointer;
}

.week__tab[aria-selected='true'] {
    color: #111;
    background: var(--c-accent);
    border-color: var(--c-accent);
}

.week__tab:focus-visible,
.week__button:focus-visible,
.week__row:focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 2px;
}

.week__button:disabled {
    cursor: not-allowed;
    opacity: 0.65;
}

.week__state {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
}

.week__state--paused {
    border-style: dashed;
    border-color: var(--c-border-strong);
}

.week__state-text {
    flex: 1;
    min-inline-size: 0;
}

.week__dot {
    inline-size: 0.5rem;
    block-size: 0.5rem;
    border-radius: 50%;
    background: var(--c-accent);
}

.week__list {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
}

.week__list--paused {
    opacity: 0.5;
}

.week__row {
    display: grid;
    grid-template-columns: 2.75rem minmax(0, 1fr) 1.5rem;
    align-items: center;
    gap: var(--space-2);
    inline-size: 100%;
    min-block-size: 2.75rem;
    padding: 0;
    font: inherit;
    color: var(--c-text);
    background: none;
    border: 0;
    cursor: pointer;
}

.week__name--today {
    color: var(--c-accent);
    font-weight: 600;
}

.week__bar {
    min-inline-size: 0;
}

.week__chevron {
    color: var(--c-text-muted);
}

.week__axis {
    position: relative;
    block-size: 1rem;
    margin-inline: calc(2.75rem + var(--space-2)) calc(1.5rem + var(--space-2));
    font-size: 0.75rem;
    color: var(--c-text-muted);
}

.week__axis span {
    position: absolute;
    transform: translateX(-50%);
}

.week__axis span:first-child {
    transform: none;
}

.week__axis span:last-child {
    transform: translateX(-100%);
}
</style>
