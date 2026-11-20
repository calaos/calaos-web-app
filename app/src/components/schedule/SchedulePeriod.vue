<!--
    One period of one day: hours and temperature by steppers, with the effects
    of the draft shown before saving. Nothing is written until Save.
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import IconBack from '~icons/mdi/chevron-left';
import ScheduleTrack from './ScheduleTrack.vue';
import { DAY_MINUTES, findOverlap, formatMinutes, isError, levelFor, setpointOf } from '../../protocol/schedule';
import type { Direction, DirectionProgram, Slot } from '../../protocol/schedule';

const props = defineProps<{
    program: DirectionProgram;
    direction: Direction;
    day: number;
    /** The period being edited; absent for a new one. */
    existing?: Slot;
    start: number;
    end: number;
    setpoint: number;
    locked: boolean;
    busy: boolean;
    min: number;
    max: number;
    /** Minutes since midnight when the day is today. */
    now?: number;
}>();

export interface PeriodEntry {
    start: number;
    end: number;
    setpoint: number;
    /** Wanted order against the overlapped setpoint, when the draft overlaps one. */
    priority?: { mineFirst: boolean; otherSetpoint: number };
}

const emit = defineEmits<{ back: []; save: [entry: PeriodEntry]; remove: [] }>();

const { t, locale } = useI18n();

const STEP_MINUTES = 15;
const STEP_DEGREES = 0.5;

const start = ref(props.start);
const end = ref(props.end);
const setpoint = ref(props.setpoint);
const swapped = ref(false);
const confirmingDelete = ref(false);

const nextDay = computed(() => (props.day % 7) + 1);
const kind = computed(() => (props.direction === 'heat' ? 'h' : 'c'));
const crossing = computed(() => end.value < start.value);
const invalid = computed(() => start.value === end.value);
const replacing = computed(() => props.program.slots.filter((s) => props.existing && sameSlot(s, props.existing)));

function sameSlot(a: Slot, b: Slot): boolean {
    return a.day === b.day && a.start === b.start && a.end === b.end && a.level === b.level;
}

function dayName(d: number): string {
    return t(`schedule.dayName.${d}`);
}

function degrees(value: number): string {
    return value.toLocaleString(locale.value, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

function wrap(value: number, lo: number, hi: number): number {
    const span = hi - lo + STEP_MINUTES;
    return ((((value - lo) % span) + span) % span) + lo;
}

function moveStart(by: number): void {
    start.value = wrap(start.value + by, 0, DAY_MINUTES - STEP_MINUTES);
}

function moveEnd(by: number): void {
    end.value = wrap(end.value + by, STEP_MINUTES, DAY_MINUTES);
}

function moveSetpoint(by: number): void {
    setpoint.value = Math.min(props.max, Math.max(props.min, setpoint.value + by));
}

const entry = computed(() => ({ day: props.day, start: start.value, end: end.value, setpoint: setpoint.value }));

const target = computed(() => levelFor(props.program, setpoint.value, replacing.value));
const tooMany = computed(() => isError(target.value) && target.value.kind === 'too_many');
const maxLevels = computed(() => (isError(target.value) && target.value.kind === 'too_many' ? target.value.max : 0));

const overlap = computed(() => (invalid.value || tooMany.value ? null : findOverlap(props.program, entry.value, replacing.value)));
const otherSetpoint = computed(() => (overlap.value ? setpointOf(props.program, overlap.value.other.level) : undefined));
const mineFirst = computed(() => {
    const o = overlap.value;
    if (!o) return true;
    return (o.mineLevel < o.other.level) !== swapped.value;
});

// A new other period resets the choice: the swap was about the previous one.
watch(
    () => overlap.value?.other.level,
    () => (swapped.value = false),
);

const slotRange = computed(() => (props.existing ? `${formatMinutes(props.existing.start)} – ${formatMinutes(props.existing.end)}` : ''));
const overlapRange = computed(() => {
    const o = overlap.value;
    return o ? `${formatMinutes(o.other.start)} – ${formatMinutes(o.other.end)}` : '';
});

const midnightText = computed(() =>
    t('schedule.v2.midnight', {
        a: `${dayName(props.day)} ${formatMinutes(start.value)} – 24:00`,
        b: `${dayName(nextDay.value)} 00:00 – ${formatMinutes(end.value)}`,
    }),
);

const priorityText = computed(() => {
    const o = overlap.value;
    if (!o || otherSetpoint.value === undefined) return '';
    return t(mineFirst.value ? 'schedule.v2.overlapMine' : 'schedule.v2.overlapOther', {
        from: formatMinutes(o.from),
        to: formatMinutes(o.to),
        setpoint: degrees(mineFirst.value ? setpoint.value : otherSetpoint.value),
    });
});

const orderText = computed(() => {
    const o = overlap.value;
    if (!o) return '';
    if (otherSetpoint.value === undefined) return '';
    const [a, b] = mineFirst.value ? [setpoint.value, otherSetpoint.value] : [otherSetpoint.value, setpoint.value];
    return t('schedule.v2.order', { a: degrees(a), b: degrees(b) });
});

const title = computed(() => (props.existing ? slotRange.value : t('schedule.addSlot')));
const canSave = computed(() => !props.locked && !props.busy && !invalid.value && !tooMany.value);

function save(): void {
    if (!canSave.value) return;
    const o = overlap.value;
    emit('save', {
        start: start.value,
        end: end.value,
        setpoint: setpoint.value,
        priority: o && otherSetpoint.value !== undefined ? { mineFirst: mineFirst.value, otherSetpoint: otherSetpoint.value } : undefined,
    });
}

/** The draft as a ring on the preview bar; a crossing one shows its first part. */
const hatch = computed(() => {
    const o = overlap.value;
    return o && o.other.day === props.day ? { start: o.from, end: o.to } : undefined;
});
const mark = computed(() => (invalid.value ? undefined : { start: start.value, end: crossing.value ? DAY_MINUTES : end.value }));
</script>

<template>
    <div class="period">
        <header class="period__head">
            <button type="button" class="period__back" @click="emit('back')">
                <IconBack aria-hidden="true" />
                <span>{{ t('schedule.v2.back', { day: dayName(day) }) }}</span>
            </button>
            <div class="period__titles">
                <h3 class="period__title">{{ title }}</h3>
                <p class="period__crumb">{{ t('schedule.v2.breadcrumb', { day: dayName(day), leaf: existing ? slotRange : t('schedule.addSlot') }) }}</p>
            </div>
        </header>

        <ScheduleTrack :program="program" :day="day" :now="now" :mark="mark" :overlap="hatch" :label="dayName(day)" />

        <div class="period__fields">
            <div class="period__field" role="group" :aria-label="t('schedule.form.start')">
                <span class="period__label">{{ t('schedule.form.start') }}</span>
                <div class="period__stepper">
                    <button type="button" class="period__step" :aria-label="`${t('schedule.form.start')} ${t('schedule.v2.minus')}`" :disabled="locked" @click="moveStart(-STEP_MINUTES)">−</button>
                    <output class="period__value" data-test="start">{{ formatMinutes(start) }}</output>
                    <button type="button" class="period__step" :aria-label="`${t('schedule.form.start')} ${t('schedule.v2.plus')}`" :disabled="locked" @click="moveStart(STEP_MINUTES)">+</button>
                </div>
            </div>
            <div class="period__field" role="group" :aria-label="t('schedule.form.end')">
                <span class="period__label">{{ t('schedule.form.end') }}</span>
                <div class="period__stepper">
                    <button type="button" class="period__step" :aria-label="`${t('schedule.form.end')} ${t('schedule.v2.minus')}`" :disabled="locked" @click="moveEnd(-STEP_MINUTES)">−</button>
                    <output class="period__value" data-test="end">
                        {{ formatMinutes(end) }}
                        <small v-if="crossing" class="period__next" data-test="next-day">{{ t('schedule.v2.nextDay') }}</small>
                    </output>
                    <button type="button" class="period__step" :aria-label="`${t('schedule.form.end')} ${t('schedule.v2.plus')}`" :disabled="locked" @click="moveEnd(STEP_MINUTES)">+</button>
                </div>
            </div>
            <div class="period__field" role="group" :aria-label="t('schedule.form.setpoint')">
                <span class="period__label">{{ t('schedule.form.setpoint') }}</span>
                <div class="period__stepper">
                    <button
                        type="button"
                        class="period__step"
                        :aria-label="`${t('schedule.form.setpoint')} ${t('schedule.v2.minus')}`"
                        :disabled="locked || setpoint <= min"
                        @click="moveSetpoint(-STEP_DEGREES)"
                    >
                        −
                    </button>
                    <output class="period__value" data-test="setpoint">
                        <span class="period__dot" :style="{ background: `var(--lv-${kind}${isError(target) ? 1 : target.n})` }" aria-hidden="true" />
                        {{ degrees(setpoint) }}°
                    </output>
                    <button
                        type="button"
                        class="period__step"
                        :aria-label="`${t('schedule.form.setpoint')} ${t('schedule.v2.plus')}`"
                        :disabled="locked || setpoint >= max"
                        @click="moveSetpoint(STEP_DEGREES)"
                    >
                        +
                    </button>
                </div>
            </div>
        </div>

        <p v-if="invalid" class="period__note period__note--error" role="alert">{{ t('schedule.v2.rangeError') }}</p>
        <p v-else-if="crossing" class="period__note period__note--info" role="status">{{ midnightText }}</p>

        <div v-if="tooMany" class="period__note period__note--error" role="alert">
            {{ t('schedule.tooMany', { n: maxLevels }) }}
        </div>

        <div v-if="overlap && otherSetpoint !== undefined" class="period__note period__note--warn" role="status" data-test="overlap">
            <p>{{ t('schedule.v2.overlap', { range: overlapRange, setpoint: degrees(otherSetpoint) }) }}</p>
            <p>{{ priorityText }}</p>
            <p class="period__order">
                <span>{{ orderText }}</span>
                <button type="button" class="period__button" :disabled="locked || busy" @click="swapped = !swapped">
                    {{ t('schedule.v2.swap') }}
                </button>
            </p>
        </div>

        <div v-if="confirmingDelete" class="period__confirm" role="alertdialog" aria-labelledby="period-delete-title">
            <p id="period-delete-title">{{ t('schedule.v2.deleteConfirm', { range: slotRange }) }}</p>
            <div class="period__actions">
                <button type="button" class="period__button" @click="confirmingDelete = false">{{ t('schedule.form.cancel') }}</button>
                <button type="button" class="period__button period__button--danger" :disabled="locked || busy" @click="emit('remove')">
                    {{ t('schedule.form.delete') }}
                </button>
            </div>
        </div>
        <footer v-else class="period__foot">
            <button v-if="existing" type="button" class="period__button period__button--danger" :disabled="locked || busy" @click="confirmingDelete = true">
                {{ t('schedule.form.delete') }}
            </button>
            <span class="period__spacer" />
            <button type="button" class="period__button" @click="emit('back')">{{ t('schedule.form.cancel') }}</button>
            <button type="button" class="period__button period__button--primary" :disabled="!canSave" @click="save">
                {{ t('schedule.form.save') }}
            </button>
        </footer>
    </div>
</template>

<style scoped>
.period {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.period__head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.period__titles {
    flex: 1;
    min-inline-size: 0;
}

.period__title,
.period__crumb {
    margin: 0;
}

.period__title {
    font-size: 1.125rem;
}

.period__crumb {
    font-size: 0.875rem;
    color: var(--c-text-muted);
    overflow-wrap: anywhere;
}

.period__fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: var(--space-3);
}

.period__field {
    display: flex;
    min-inline-size: 0;
    flex-direction: column;
    gap: var(--space-1);
}

.period__label {
    font-size: 0.875rem;
    color: var(--c-text-muted);
}

.period__stepper {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.period__value {
    display: inline-flex;
    flex: 1;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    min-inline-size: 3rem;
    font-size: 1.25rem;
    font-weight: 600;
    text-align: center;
}

.period__next {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--c-warn);
}

.period__dot {
    inline-size: 0.75rem;
    block-size: 0.75rem;
    border-radius: 50%;
}

.period__back,
.period__step,
.period__button {
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

.period__button--primary {
    color: var(--c-on-accent);
    background: var(--c-accent);
    border-color: var(--c-accent);
}

.period__button--danger {
    color: var(--c-danger-text);
    border-color: var(--c-danger);
}

.period__back:focus-visible,
.period__step:focus-visible,
.period__button:focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 2px;
}

button:disabled {
    cursor: not-allowed;
    opacity: 0.65;
}

.period__note {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--radius-md);
}

.period__note p {
    margin: 0;
}

.period__note--error {
    color: var(--c-danger-text);
    border-color: var(--c-danger);
}

.period__note--warn {
    background: var(--c-warn-bg);
    border-color: var(--c-warn-border);
}

.period__order {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-4);
    margin-block-start: var(--space-2);
}

.period__confirm {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--c-danger);
    border-radius: var(--radius-md);
}

.period__confirm p {
    margin: 0;
}

.period__foot,
.period__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
}

.period__actions {
    justify-content: flex-end;
}

.period__spacer {
    flex: 1;
}
</style>
