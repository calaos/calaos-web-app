<!--
    Climate program editor. Every change is written at once: one set_state per
    changed level setpoint, then one set_timerange per changed level, in
    sequence. Week, day and period are three views over the same program.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ScheduleCopySheet from './ScheduleCopySheet.vue';
import ScheduleDay from './ScheduleDay.vue';
import SchedulePeriod from './SchedulePeriod.vue';
import ScheduleWeek from './ScheduleWeek.vue';
import type { PeriodEntry } from './SchedulePeriod.vue';
import { useProgram } from '../../composables/useProgram';
import { useConnectionStore } from '../../stores/connection';
import { useScheduleStore } from '../../stores/schedule';
import {
    WEEKDAYS,
    copyDay,
    diffPrograms,
    errorKey,
    isError,
    levelFor,
    levelIos,
    levelRanges,
    programFromWire,
    removeSlots,
    setpointOf,
    slotsOfDay,
    sortSlots,
    swapLevels,
    upsertSlot,
} from '../../protocol/schedule';
import type { Direction, DirectionProgram, ProgramEdit, ScheduleError, Slot } from '../../protocol/schedule';
import type { IoItem } from '../../protocol/types';

const props = withDefaults(defineProps<{ io: IoItem; readonly?: boolean }>(), { readonly: false });

const { t, locale } = useI18n();
const store = useScheduleStore();
const connection = useConnectionStore();

const SETPOINT_MIN = 7;
const SETPOINT_MAX = 30;
const FALLBACK_SETPOINT: Record<Direction, number> = { heat: 20, cool: 26 };

const ios = computed(() => props.io.device?.ios ?? {});
const levelsOf = computed(() => ({ heat: levelIos(ios.value, 'heat'), cool: levelIos(ios.value, 'cool') }));
const directions = computed(() => (['heat', 'cool'] as Direction[]).filter((d) => levelsOf.value[d].length > 0));

/** Week is the root; a day opens over it, a period over the day. */
const view = ref<'week' | 'day' | 'period'>('week');
const direction = ref<Direction>('heat');
const day = ref(isoDay(new Date()));
const now = ref(minutesOf(new Date()));

const read = reactive<Partial<Record<Direction, DirectionProgram>>>({});
const loading = ref(true);
const loadFailed = ref(false);
const busy = ref(false);
const banner = ref<{ text: string; retry?: () => void } | null>(null);
/** Refusals that never reached the server (7th level, bad range, nothing to copy). */
const notice = ref('');
const done = ref('');

const locked = computed(() => props.readonly || !connection.isOpen || loadFailed.value);

function isoDay(date: Date): number {
    return ((date.getDay() + 6) % 7) + 1;
}

function minutesOf(date: Date): number {
    return date.getHours() * 60 + date.getMinutes();
}

function degrees(value: number): string {
    return value.toLocaleString(locale.value, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

function dirName(d: Direction): string {
    return t(`schedule.${d}`);
}

function errorText(error: string): string {
    return error === 'offline' ? t('schedule.error.offline') : t(`schedule.error.${errorKey(error)}`);
}

function refusal(error: ScheduleError, d: Direction): string {
    if (error.kind === 'too_many') return t('schedule.tooMany', { n: error.max, dir: dirName(d) });
    return error.kind === 'invalid_range' ? t('schedule.error.range') : t('schedule.error.generic');
}

// ------------------------------------------------------------ values ---

function numberValue(id: string | undefined): number | undefined {
    const raw = id ? store.values.get(id) : undefined;
    const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
    return Number.isFinite(n) ? n : undefined;
}

/** Level setpoints live in the store (io_changed keeps them fresh). */
function programOf(d: Direction): DirectionProgram | undefined {
    const p = read[d];
    if (!p) return undefined;
    const ids = levelsOf.value[d];
    return {
        ...p,
        levels: p.levels.map((l) => {
            const v = numberValue(ids.find((x) => x.n === l.n)?.setpointId);
            return v === undefined ? l : { ...l, setpoint: v };
        }),
    };
}

const program = computed(() => programOf(direction.value));
const coolOff = computed(() => store.values.get(ios.value.cool_default_off ?? '') === 'true');
const defaultOf = (d: Direction) => numberValue(d === 'heat' ? ios.value.heat_default : ios.value.cool_default);

const daySlots = computed(() => (program.value ? slotsOfDay(program.value, day.value) : []));
const emptyText = computed(() => {
    if (direction.value === 'cool' && coolOff.value) return t('schedule.emptyOff');
    const v = defaultOf(direction.value);
    const setpoint = v === undefined ? '–' : degrees(v);
    return t(direction.value === 'heat' ? 'schedule.empty' : 'schedule.emptyCool', { setpoint });
});
const pausedText = computed(() => {
    const v = programCtl.current.value?.setpoint;
    return v === undefined || v === null ? t('program.paused') : t('schedule.v2.paused', { setpoint: degrees(v) });
});
const subtitle = computed(() => `${props.io.name ?? ''} · ${dirName(direction.value)}`.replace(/^ · /, ''));

// --------------------------------------------------------------- read ---

async function loadDirection(d: Direction): Promise<string> {
    const ids = levelsOf.value[d];
    const results = await Promise.all(ids.map((l) => store.readRanges(l.id)));
    const error = results.find((r) => r.error !== '')?.error ?? '';
    // A level that could not be read must not look empty: a save would erase it.
    if (error === '' || !read[d]) {
        read[d] = programFromWire(
            d,
            ids.map((l, i) => ({ n: l.n, ranges: results[i].ranges, setpoint: undefined })),
        );
    }
    return error;
}

function valueIds(): string[] {
    const v = ios.value;
    const levels = [...levelsOf.value.heat, ...levelsOf.value.cool].map((l) => l.setpointId);
    return [...levels, v.heat_default ?? '', v.cool_default ?? '', v.cool_default_off ?? ''];
}

async function load(): Promise<void> {
    loading.value = read.heat === undefined && read.cool === undefined;
    banner.value = null;
    store.watchValues(valueIds());
    const errors = await Promise.all(directions.value.map(loadDirection));
    loading.value = false;
    const error = errors.find((e) => e !== '') ?? '';
    loadFailed.value = error !== '';
    if (loadFailed.value) banner.value = { text: errorText(error), retry: () => void load() };
    else void flushStale();
}

/** Levels whose timerange_changed could not be applied yet (loading, writing, failed read). */
const stale = new Set<string>();

/** Bumped when a write starts: a re-read begun before it describes a server that has since changed. */
let writeGeneration = 0;

async function rereadLevel(id: string): Promise<void> {
    for (const d of directions.value) {
        const io = levelsOf.value[d].find((l) => l.id === id);
        if (!io) continue;
        if (!read[d] || busy.value) {
            stale.add(id);
            continue;
        }
        const generation = writeGeneration;
        const r = await store.readRanges(id);
        const current = read[d];
        if (r.error !== '' || !current) {
            stale.add(id);
            continue;
        }
        if (generation !== writeGeneration) {
            // A write overtook this answer; while it runs its own flushStale will pick the id up.
            if (busy.value) stale.add(id);
            else await rereadLevel(id);
            continue;
        }
        const one = programFromWire(d, [{ n: io.n, ranges: r.ranges, setpoint: undefined }]);
        read[d] = {
            ...current,
            levels: current.levels.map((l) => (l.n === io.n ? { ...l, kept: one.levels[0].kept } : l)),
            slots: sortSlots([...current.slots.filter((s) => s.level !== io.n), ...one.slots]),
        };
    }
}

async function flushStale(): Promise<void> {
    const ids = [...stale];
    stale.clear();
    for (const id of ids) await rereadLevel(id);
}

/** timerange_changed carries only the id: re-read that level. */
watch(
    () => store.changes,
    () => void rereadLevel(store.changedId),
);

// -------------------------------------------------------------- write ---

function sameProgram(a: DirectionProgram, b: DirectionProgram): boolean {
    const diff = diffPrograms(a, b);
    return diff.ranges.length === 0 && diff.setpoints.length === 0;
}

/**
 * Builds the next program from the current one and writes the difference.
 * On failure the direction is re-read so the screen shows what the server
 * really holds; Retry replays the edit on that state, so a change another
 * client made in between is kept.
 */
async function apply(
    d: Direction,
    build: ProgramEdit,
    failText?: string,
    onSuccess?: () => void,
    unwritten: number[] = [],
): Promise<DirectionProgram | null> {
    const before = programOf(d);
    if (!before || locked.value) return null;
    const next = build(before);
    notice.value = '';
    done.value = '';
    if (isError(next)) {
        notice.value = refusal(next, d);
        return null;
    }
    const diff = diffPrograms(before, next);
    const ids = levelsOf.value[d];
    busy.value = true;
    writeGeneration++;
    banner.value = null;
    let error = '';
    for (const n of diff.setpoints) {
        const io = ids.find((l) => l.n === n);
        const sp = setpointOf(next, n);
        if (!io || io.setpointId === '' || sp === undefined) continue;
        error = await store.writeValue(io.setpointId, String(sp));
        if (error !== '') break;
    }
    const notWritten: number[] = [];
    // Levels the server holds in memory only are re-sent even though a re-read shows no difference.
    for (const n of error === '' ? [...new Set([...diff.ranges, ...unwritten])] : []) {
        const io = ids.find((l) => l.n === n);
        if (!io) continue;
        const e = await store.writeRanges(io.id, levelRanges(next, n));
        if (e === '') continue;
        // The server kept the change in memory: the other levels must still be written.
        if (e === 'config_not_written') {
            notWritten.push(n);
            error ||= e;
            continue;
        }
        error = e;
        break;
    }
    busy.value = false;
    void flushStale();
    if (error === '') {
        read[d] = next;
        onSuccess?.();
        return next;
    }
    const pending = error === 'config_not_written' ? [...new Set([...unwritten, ...notWritten])] : notWritten;
    banner.value = {
        text: failText ?? errorText(error),
        retry: () => void apply(d, (current) => (sameProgram(current, next) ? current : build(current)), failText, onSuccess, pending),
    };
    await loadDirection(d);
    return null;
}

async function writeValue(id: string | undefined, value: string): Promise<void> {
    if (!id || locked.value) return;
    busy.value = true;
    banner.value = null;
    const error = await store.writeValue(id, value);
    busy.value = false;
    if (error !== '') banner.value = { text: errorText(error), retry: () => void writeValue(id, value) };
}

// ------------------------------------------------------------- period ---

interface Draft {
    slot?: Slot;
    start: number;
    end: number;
    setpoint: number;
}

const draft = ref<Draft | null>(null);
/** A new key per opening: the period view keeps its own draft until then. */
const draftKey = ref(0);

function sameSlot(a: Slot, b: Slot): boolean {
    return a.day === b.day && a.start === b.start && a.end === b.end && a.level === b.level;
}

function openPeriod(next: Draft): void {
    notice.value = '';
    draft.value = next;
    draftKey.value++;
    view.value = 'period';
}

function openNew(): void {
    openPeriod({ start: 8 * 60, end: 10 * 60, setpoint: defaultOf(direction.value) ?? FALLBACK_SETPOINT[direction.value] });
}

function openSlot(slot: Slot): void {
    const p = program.value;
    if (!p) return;
    const setpoint = setpointOf(p, slot.level) ?? defaultOf(direction.value) ?? FALLBACK_SETPOINT[direction.value];
    openPeriod({ slot, start: slot.start, end: slot.end, setpoint });
}

/** Puts the two overlapping setpoints in the wanted order; a no-op once they are, so a retry cannot undo it. */
function orderLevels(p: DirectionProgram, setpoint: number, priority: NonNullable<PeriodEntry['priority']>): DirectionProgram {
    const mine = levelFor(p, setpoint);
    const other = levelFor(p, priority.otherSetpoint);
    if (isError(mine) || isError(other) || mine.n === other.n) return p;
    return mine.n < other.n === priority.mineFirst ? p : swapLevels(p, mine.n, other.n);
}

async function savePeriod(entry: PeriodEntry): Promise<void> {
    const origin = draft.value?.slot;
    const target = { days: [day.value], start: entry.start, end: entry.end, setpoint: entry.setpoint };
    await apply(
        direction.value,
        (p) => {
            const next = upsertSlot(p, target, origin ? p.slots.filter((s) => sameSlot(s, origin)) : []);
            return isError(next) || !entry.priority ? next : orderLevels(next, entry.setpoint, entry.priority);
        },
        undefined,
        backToDay,
    );
}

async function removePeriod(): Promise<void> {
    const origin = draft.value?.slot;
    if (!origin) return;
    await apply(direction.value, (p) => removeSlots(p, p.slots.filter((s) => sameSlot(s, origin))), undefined, backToDay);
}

function backToDay(): void {
    view.value = 'day';
    draft.value = null;
}

// --------------------------------------------------------------- copy ---

const copyOpen = ref(false);
const bannerBox = ref<HTMLElement | null>(null);
const noticeBox = ref<HTMLElement | null>(null);

const dayCounts = computed(() =>
    Object.fromEntries(WEEKDAYS.map((d) => [d, program.value ? slotsOfDay(program.value, d).length : 0])) as Record<number, number>,
);

// The editor sits in a scrolling dialog: an error raised from the bottom of it must not stay off screen.
watch([banner, notice], async () => {
    await nextTick();
    (banner.value ? bannerBox.value : noticeBox.value)?.scrollIntoView?.({ block: 'nearest' });
});

function openCopy(): void {
    if (daySlots.value.length === 0) {
        notice.value = t('schedule.copy.nothing');
        return;
    }
    notice.value = '';
    copyOpen.value = true;
}

async function runCopy(targets: number[]): Promise<void> {
    const source = day.value;
    await apply(direction.value, (p) => copyDay(p, source, targets), t('schedule.copy.failed'), () => (copyOpen.value = false));
}

// --------------------------------------------------------------- misc ---

function selectDirection(d: Direction): void {
    direction.value = d;
    notice.value = '';
}

function selectDay(d: number): void {
    day.value = d;
    view.value = 'day';
    notice.value = '';
}

const rootEl = ref<HTMLElement>();

function backToWeek(): void {
    const from = day.value;
    view.value = 'week';
    draft.value = null;
    copyOpen.value = false;
    notice.value = '';
    // The back button unmounts; focus would fall to body.
    void nextTick(() => {
        const rows = rootEl.value?.querySelectorAll<HTMLElement>('.week__row');
        rows?.[(WEEKDAYS as readonly number[]).indexOf(from)]?.focus();
    });
}

// The clicked row unmounts with the view it opened; without this focus falls to body and Escape is lost.
watch(view, (now) => {
    if (now === 'week') return;
    void nextTick(() => rootEl.value?.querySelector<HTMLElement>(now === 'day' ? '.day__back' : '.period__back')?.focus());
});

/** Escape is the back button of the view; only the week lets it reach the dialog. */
function onEscape(event: KeyboardEvent): void {
    if (view.value === 'week') return;
    event.stopPropagation();
    event.preventDefault();
    if (view.value === 'period') backToDay();
    else backToWeek();
}

let clock: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
    if (!directions.value.includes(direction.value)) direction.value = directions.value[0] ?? 'heat';
    clock = setInterval(() => (now.value = minutesOf(new Date())), 60_000);
    void load();
});
onBeforeUnmount(() => clearInterval(clock));

const programCtl = useProgram(() => props.io);
const paused = computed(() => programCtl.state.value !== undefined && !programCtl.enabled.value);
</script>

<template>
    <div ref="rootEl" class="schedule" @keydown.esc="onEscape">
        <div v-if="loading" class="schedule__loading" role="status">
            <div class="schedule__skeleton" aria-hidden="true" />
            <p>{{ t('schedule.loading') }}</p>
        </div>

        <template v-else>
            <div v-if="banner" ref="bannerBox" class="schedule__banner" role="alert">
                <span>{{ banner.text }}</span>
                <button v-if="banner.retry" type="button" class="schedule__button" :disabled="busy" @click="banner.retry()">
                    {{ t('schedule.retry') }}
                </button>
            </div>
            <p v-if="programCtl.error.value" class="schedule__notice" role="alert">{{ programCtl.error.value }}</p>
            <p v-if="readonly || !connection.isOpen" class="schedule__muted">{{ t('schedule.readOnly') }}</p>

            <ScheduleWeek
                v-if="program && view === 'week'"
                :program="program"
                :directions="directions"
                :direction="direction"
                :today="isoDay(new Date())"
                :now="now"
                :paused="paused"
                :paused-text="pausedText"
                :can-toggle="!programCtl.readonly.value && !readonly"
                :saving="programCtl.saving.value"
                @direction="selectDirection"
                @day="selectDay"
                @toggle="programCtl.toggle()"
            />

            <SchedulePeriod
                v-else-if="program && view === 'period' && draft"
                :key="draftKey"
                :program="program"
                :direction="direction"
                :day="day"
                :existing="draft.slot"
                :start="draft.start"
                :end="draft.end"
                :setpoint="draft.setpoint"
                :locked="locked"
                :busy="busy"
                :min="SETPOINT_MIN"
                :max="SETPOINT_MAX"
                :now="day === isoDay(new Date()) ? now : undefined"
                @back="backToDay"
                @save="savePeriod"
                @remove="removePeriod"
            />

            <ScheduleDay
                v-else-if="program"
                :program="program"
                :direction="direction"
                :day="day"
                :slots="daySlots"
                :subtitle="subtitle"
                :now="day === isoDay(new Date()) ? now : undefined"
                :empty-text="emptyText"
                :locked="locked"
                :busy="busy"
                :default-value="defaultOf(direction)"
                :default-min="SETPOINT_MIN"
                :default-max="SETPOINT_MAX"
                :off-toggle="direction === 'cool' && !!ios.cool_default_off"
                :off="direction === 'cool' && coolOff"
                :has-default="!!ios[`${direction}_default`]"
                @back="backToWeek"
                @add="openNew()"
                @open="openSlot"
                @copy="openCopy"
                @set-default="(v) => writeValue(ios[`${direction}_default`], String(v))"
                @set-off="(v) => writeValue(ios.cool_default_off, v ? 'true' : 'false')"
            />

            <p v-if="notice && view !== 'period'" ref="noticeBox" class="schedule__notice" role="alert">{{ notice }}</p>
            <p v-if="done" class="schedule__muted" role="status">{{ done }}</p>

            <ScheduleCopySheet
                v-if="copyOpen && view === 'day'"
                :day="day"
                :counts="dayCounts"
                :locked="locked"
                :busy="busy"
                :error="banner?.text"
                @cancel="copyOpen = false"
                @copy="runCopy"
            />
        </template>
    </div>
</template>

<style scoped>
.schedule {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    color: var(--c-text);
}

.schedule__loading {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    color: var(--c-text-muted);
}

.schedule__skeleton {
    block-size: 2.75rem;
    background: var(--c-track);
    border-radius: var(--radius-sm);
    animation: schedule-pulse 1.2s ease-in-out infinite alternate;
}

@keyframes schedule-pulse {
    to {
        opacity: 0.5;
    }
}

@media (prefers-reduced-motion: reduce) {
    .schedule__skeleton {
        animation: none;
    }
}

.schedule__banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    color: var(--c-danger-text);
    border: 1px solid var(--c-danger);
    border-radius: var(--radius-md);
}

.schedule__notice {
    margin: 0;
    color: var(--c-danger-text);
}

.schedule__muted {
    margin: 0;
    font-size: 0.875rem;
    color: var(--c-text-muted);
}

.schedule__button {
    min-block-size: 2.75rem;
    min-inline-size: 2.75rem;
    padding: 0 var(--space-3);
    font: inherit;
    color: var(--c-text);
    background: var(--c-surface-raised);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    cursor: pointer;
}

.schedule__button:focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 2px;
}

.schedule__button:disabled {
    cursor: not-allowed;
    opacity: 0.65;
}
</style>
