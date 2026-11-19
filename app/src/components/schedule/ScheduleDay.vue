<!--
    One day of one direction: back to the week, a preview bar, then one row per
    period. Opening a period and copying are the editor's views.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import IconBack from '~icons/mdi/chevron-left';
import IconChevron from '~icons/mdi/chevron-right';
import IconPlus from '~icons/mdi/plus';
import ScheduleTrack from './ScheduleTrack.vue';
import { formatMinutes, setpointOf } from '../../protocol/schedule';
import type { Direction, DirectionProgram, Slot } from '../../protocol/schedule';

const props = defineProps<{
    program: DirectionProgram;
    direction: Direction;
    day: number;
    slots: Slot[];
    subtitle: string;
    /** Minutes since midnight when the day is today. */
    now?: number;
    /** Empty-day sentence ("Heating stays at 17° all day."). */
    emptyText: string;
    locked: boolean;
    busy: boolean;
    defaultValue?: number;
    defaultMin: number;
    defaultMax: number;
    /** Cooling can be switched off outside the periods. */
    offToggle: boolean;
    off: boolean;
    hasDefault: boolean;
}>();

const emit = defineEmits<{
    back: [];
    add: [];
    open: [slot: Slot];
    copy: [];
    setDefault: [value: number];
    setOff: [value: boolean];
}>();

const { t, locale } = useI18n();

const kind = computed(() => (props.direction === 'heat' ? 'h' : 'c'));
const STEP = 0.5;

function degrees(value: number): string {
    return value.toLocaleString(locale.value, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

function range(s: Slot): string {
    return `${formatMinutes(s.start)} – ${formatMinutes(s.end)}`;
}

function temp(s: Slot): string {
    const v = setpointOf(props.program, s.level);
    return v === undefined ? '–' : `${degrees(v)}°`;
}

function step(by: number): void {
    if (props.defaultValue === undefined) return;
    const next = Math.min(props.defaultMax, Math.max(props.defaultMin, props.defaultValue + by));
    if (next !== props.defaultValue) emit('setDefault', next);
}

const countText = computed(() => t('schedule.v2.count', { n: props.slots.length }, props.slots.length));
</script>

<template>
    <div class="day">
        <header class="day__head">
            <button type="button" class="day__back" @click="emit('back')">
                <IconBack aria-hidden="true" />
                <span>{{ t('schedule.week') }}</span>
            </button>
            <div class="day__titles">
                <h3 class="day__title">{{ t(`schedule.dayName.${day}`) }}</h3>
                <p class="day__subtitle">
                    <span class="day__lead">{{ subtitle }}</span> <span class="day__count">{{ countText }}</span>
                </p>
            </div>
            <button type="button" class="day__action" :disabled="locked || busy || slots.length === 0" @click="emit('copy')">
                {{ t('schedule.copy.open') }}
            </button>
        </header>

        <ScheduleTrack :program="program" :day="day" :now="now" :label="t(`schedule.dayName.${day}`)" />

        <div v-if="slots.length === 0" class="day__empty">
            <strong>{{ t('schedule.v2.emptyTitle') }}</strong>
            <p>{{ emptyText }}</p>
            <button type="button" class="day__primary" :disabled="locked || busy" @click="emit('add')">
                {{ t('schedule.addSlot') }}
            </button>
        </div>

        <ul v-else class="day__list">
            <li v-for="s in slots" :key="`${s.start}-${s.level}`">
                <button type="button" class="day__row" :aria-label="`${t('schedule.v2.edit')} ${range(s)}, ${temp(s)}`" @click="emit('open', s)">
                    <span class="day__dot" :style="{ background: `var(--lv-${kind}${s.level})` }" aria-hidden="true" />
                    <span class="day__range" aria-hidden="true">{{ range(s) }}</span>
                    <span class="day__temp" aria-hidden="true">{{ temp(s) }}</span>
                    <span class="day__edit" aria-hidden="true">{{ t('schedule.v2.edit') }}</span>
                    <IconChevron class="day__chevron" aria-hidden="true" />
                </button>
            </li>
            <li>
                <button type="button" class="day__row day__row--add" :disabled="locked || busy" @click="emit('add')">
                    <IconPlus aria-hidden="true" />
                    <span>{{ t('schedule.addSlot') }}</span>
                </button>
            </li>
        </ul>

        <footer v-if="hasDefault || offToggle" class="day__rest">
            <span class="day__rest-label">{{ t('schedule.v2.rest') }}</span>
            <label v-if="offToggle" class="day__off">
                <input type="checkbox" :checked="off" :disabled="locked || busy" @change="emit('setOff', ($event.target as HTMLInputElement).checked)" />
                <span>{{ t('schedule.coolOff') }}</span>
            </label>
            <div v-if="hasDefault && !off" class="day__stepper" role="group" :aria-label="t('schedule.defaultSetpoint')">
                <button
                    type="button"
                    class="day__step"
                    :aria-label="t('schedule.v2.minus')"
                    :disabled="locked || busy || defaultValue === undefined || defaultValue <= defaultMin"
                    @click="step(-STEP)"
                >
                    −
                </button>
                <output class="day__value">{{ defaultValue === undefined ? '–' : `${degrees(defaultValue)}°` }}</output>
                <button
                    type="button"
                    class="day__step"
                    :aria-label="t('schedule.v2.plus')"
                    :disabled="locked || busy || defaultValue === undefined || defaultValue >= defaultMax"
                    @click="step(STEP)"
                >
                    +
                </button>
            </div>
        </footer>
    </div>
</template>

<style scoped>
.day {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.day__head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.day__titles {
    flex: 1;
    min-inline-size: 0;
}

.day__title,
.day__subtitle {
    margin: 0;
}

.day__action {
    flex-shrink: 0;
    white-space: nowrap;
}

.day__title {
    overflow: hidden;
    font-size: 1.125rem;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.day__subtitle {
    font-size: 0.875rem;
    color: var(--c-text-muted);
    overflow-wrap: anywhere;
}

/* The separator trails the first part, so a wrapped line never starts on it. */
.day__lead::after {
    content: '\00a0·';
}

.day__count {
    white-space: nowrap;
}

.day__back,
.day__action,
.day__primary,
.day__step {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    min-block-size: 44px;
    min-inline-size: 44px;
    padding: 0 var(--space-3);
    font: inherit;
    color: var(--c-text);
    background: var(--c-surface-raised);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    cursor: pointer;
}

.day__primary {
    color: var(--c-on-accent);
    background: var(--c-accent);
    border-color: var(--c-accent);
}

.day__back:focus-visible,
.day__action:focus-visible,
.day__primary:focus-visible,
.day__step:focus-visible,
.day__row:focus-visible,
.day__off input:focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 2px;
}

button:disabled {
    cursor: not-allowed;
    opacity: 0.65;
}

.day__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-4);
    text-align: center;
    border: 1px dashed var(--c-border-strong);
    border-radius: var(--radius-md);
}

.day__empty p {
    margin: 0;
    color: var(--c-text-muted);
}

.day__list {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
}

.day__row {
    display: grid;
    grid-template-columns: 1rem 1fr auto auto 1.5rem;
    align-items: center;
    gap: var(--space-3);
    inline-size: 100%;
    min-block-size: 44px;
    padding: 0 var(--space-2);
    font: inherit;
    color: var(--c-text);
    text-align: start;
    background: none;
    border: 0;
    border-block-end: 1px solid var(--c-border);
    cursor: pointer;
}

.day__dot {
    inline-size: 0.75rem;
    block-size: 0.75rem;
    border-radius: 50%;
}

.day__temp {
    font-weight: 600;
}

.day__edit {
    font-size: 0.875rem;
    color: var(--c-accent);
}

.day__chevron {
    color: var(--c-text-muted);
}

.day__row--add {
    display: flex;
    justify-content: center;
    gap: var(--space-2);
    margin-block-start: var(--space-2);
    color: var(--c-accent);
    border: 1px dashed var(--c-border-strong);
    border-radius: var(--radius-md);
}

.day__rest {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding-block-start: var(--space-2);
}

.day__off {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-block-size: 44px;
}

.day__off input {
    inline-size: 1.25rem;
    block-size: 1.25rem;
    accent-color: var(--c-accent);
    /* The native box follows the theme; otherwise it stays white in dark mode. */
    color-scheme: inherit;
}

.day__stepper {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.day__value {
    min-inline-size: 3.5rem;
    font-weight: 600;
    text-align: center;
}
</style>
