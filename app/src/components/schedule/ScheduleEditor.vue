<!--
    Climate program editor. Every change is written at once: one set_state per
    changed level setpoint, then one set_timerange per changed level, in
    sequence. 'simple' is the one-entry form the scenarios reuse.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ScheduleDay from './ScheduleDay.vue';
import ScheduleWeek from './ScheduleWeek.vue';
import { useProgram } from '../../composables/useProgram';
import { useConnectionStore } from '../../stores/connection';
import { useScheduleStore } from '../../stores/schedule';
import {
    WEEKDAYS,
    WEEKEND,
    WORKDAYS,
    applySimple,
    copyDay,
    diffPrograms,
    errorKey,
    formatMinutes,
    isError,
    levelIos,
    levelRanges,
    moveLevel,
    parseMinutes,
    programFromWire,
    removeSlots,
    setpointOf,
    slotsOfDay,
    sortSlots,
    upsertSlot,
    usedLevels,
} from '../../protocol/schedule';
import type { Direction, DirectionProgram, ProgramEdit, ScheduleError, Slot } from '../../protocol/schedule';
import type { IoItem } from '../../protocol/types';

const props = withDefaults(defineProps<{ io: IoItem; mode?: 'multi' | 'simple'; readonly?: boolean }>(), {
    mode: 'multi',
    readonly: false,
});

const { t, locale } = useI18n();
const store = useScheduleStore();
const connection = useConnectionStore();

const SETPOINT_MIN = 7;
const SETPOINT_MAX = 30;
const FALLBACK_SETPOINT: Record<Direction, number> = { heat: 20, cool: 26 };

const ios = computed(() => props.io.device?.ios ?? {});
const levelsOf = computed(() => ({ heat: levelIos(ios.value, 'heat'), cool: levelIos(ios.value, 'cool') }));
const directions = computed(() => (['heat', 'cool'] as Direction[]).filter((d) => levelsOf.value[d].length > 0));

/** Week is the root; a day opens over it. The scenario form has no week. */
const view = ref<'week' | 'day'>('week');
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

function dayName(d: number): string {
    return t(`schedule.dayName.${d}`);
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

const gapLabel = computed(() => {
    if (direction.value === 'cool' && coolOff.value) return t('schedule.off');
    const v = defaultOf(direction.value);
    return v === undefined ? '' : t('schedule.gapDefault', { setpoint: degrees(v) });
});

const used = computed(() => (program.value ? usedLevels(program.value) : []));
const levelCount = computed(() => levelsOf.value[direction.value].length);
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

// --------------------------------------------------------------- form ---

interface FormState {
    replacing: Slot[];
    start: string;
    end: string;
    setpoint: number;
    days: number[];
    level?: number;
}

const form = ref<FormState | null>(null);

/** input[type=time] has no 24:00: midnight as an end is typed 00:00. */
function timeText(m: number): string {
    return m >= 1440 ? '00:00' : formatMinutes(m);
}

function sameSlot(a: Slot, b: Slot): boolean {
    return a.day === b.day && a.start === b.start && a.end === b.end && a.level === b.level;
}

function suggestedSetpoint(fresh: boolean): number {
    const base = defaultOf(direction.value) ?? FALLBACK_SETPOINT[direction.value];
    if (!fresh || !program.value) return base;
    const taken = new Set(used.value.map((n) => setpointOf(program.value as DirectionProgram, n)));
    let v = base;
    while (taken.has(v) && v < SETPOINT_MAX) v += 0.5;
    return v;
}

function openNew(fresh = false): void {
    notice.value = '';
    form.value = { replacing: [], start: '08:00', end: '10:00', setpoint: suggestedSetpoint(fresh), days: [day.value] };
}

function openSlot(level: number, at: number): void {
    const p = program.value;
    const slot = daySlots.value.find((s) => s.level === level && s.start <= at && at < s.end);
    if (!p || !slot) return;
    notice.value = '';
    form.value = {
        replacing: [slot],
        start: timeText(slot.start),
        end: timeText(slot.end),
        setpoint: setpointOf(p, level) ?? suggestedSetpoint(false),
        days: [slot.day],
        level,
    };
}

function toggle(list: number[], d: number): number[] {
    return list.includes(d) ? list.filter((x) => x !== d) : [...list, d].sort();
}

function entryOf(f: FormState): { days: number[]; start: number; end: number; setpoint: number } | null {
    const start = parseMinutes(f.start);
    const end = parseMinutes(f.end);
    if (Number.isNaN(start) || Number.isNaN(end) || f.days.length === 0) {
        notice.value = t('schedule.error.range');
        return null;
    }
    return { days: f.days, start, end, setpoint: f.setpoint };
}

async function saveForm(): Promise<void> {
    const f = form.value;
    const entry = f ? entryOf(f) : null;
    if (!f || !entry) return;
    await apply(direction.value, (p) =>
        upsertSlot(
            p,
            entry,
            p.slots.filter((s) => f.replacing.some((r) => sameSlot(r, s))),
        ),
        undefined,
        () => (form.value = null),
    );
}

async function deleteForm(): Promise<void> {
    const f = form.value;
    if (!f) return;
    await apply(
        direction.value,
        (p) => removeSlots(p, p.slots.filter((s) => f.replacing.some((r) => sameSlot(r, s)))),
        undefined,
        () => (form.value = null),
    );
}

async function move(by: -1 | 1): Promise<void> {
    const f = form.value;
    if (!f?.level) return;
    const n = f.level;
    const next = await apply(direction.value, (p) => moveLevel(p, n, by));
    if (!next || form.value !== f) return;
    f.level = n + by;
    f.replacing = f.replacing.map((s) => ({ ...s, level: n + by }));
}

async function applySimpleForm(): Promise<void> {
    const f = form.value;
    const entry = f ? entryOf(f) : null;
    if (!entry) return;
    const next = await apply(direction.value, (p) => applySimple(p, entry));
    const level = next?.slots.find((s) => s.day === entry.days[0] && s.start === entry.start)?.level;
    if (level !== undefined) done.value = t('schedule.simple.applied', { n: level });
}

// --------------------------------------------------------------- copy ---

const copyOpen = ref(false);
const copyTargets = ref<number[]>([]);
const confirming = ref(false);
const confirmBox = ref<HTMLElement | null>(null);
const bannerBox = ref<HTMLElement | null>(null);
const noticeBox = ref<HTMLElement | null>(null);

// The editor sits in a scrolling dialog: an error raised from the bottom of it must not stay off screen.
watch([banner, notice], async () => {
    await nextTick();
    (banner.value ? bannerBox.value : noticeBox.value)?.scrollIntoView?.({ block: 'nearest' });
});

function openCopy(): void {
    form.value = null;
    done.value = '';
    if (daySlots.value.length === 0) {
        notice.value = t('schedule.copy.nothing');
        return;
    }
    notice.value = '';
    copyTargets.value = [];
    confirming.value = false;
    copyOpen.value = true;
}

function pick(list: readonly number[]): void {
    copyTargets.value = list.filter((d) => d !== day.value);
}

const occupied = computed(() =>
    copyTargets.value
        .map((d) => ({ d, count: program.value ? slotsOfDay(program.value, d).length : 0 }))
        .filter((x) => x.count > 0),
);

const confirmText = computed(() => {
    const parts = occupied.value.map((x) => t('schedule.copy.slots', { day: dayName(x.d), count: x.count }, x.count));
    const targets = parts.length > 1 ? t('schedule.copy.and', { list: parts.slice(0, -1).join(', '), last: parts.at(-1) }) : (parts[0] ?? '');
    const text = t('schedule.copy.confirm', { targets, source: dayName(day.value) }, parts.length);
    return text.charAt(0).toLocaleUpperCase(locale.value) + text.slice(1);
});

function submitCopy(): void {
    if (occupied.value.length > 0) {
        confirming.value = true;
        void Promise.resolve().then(() => confirmBox.value?.focus());
    } else {
        void runCopy();
    }
}

async function runCopy(): Promise<void> {
    const source = day.value;
    const targets = [...copyTargets.value];
    confirming.value = false;
    await apply(direction.value, (p) => copyDay(p, source, targets), t('schedule.copy.failed'), () => (copyOpen.value = false));
}

// --------------------------------------------------------------- misc ---

function selectDirection(d: Direction): void {
    direction.value = d;
    form.value = null;
    copyOpen.value = false;
    notice.value = '';
    done.value = '';
    if (props.mode === 'simple') openNew();
}

function selectDay(d: number): void {
    day.value = d;
    view.value = 'day';
    form.value = null;
    copyOpen.value = false;
    notice.value = '';
}

function backToWeek(): void {
    view.value = 'week';
    form.value = null;
    copyOpen.value = false;
    notice.value = '';
    done.value = '';
}

/** Escape is the back button of the view; only the week lets it reach the dialog. */
function onEscape(event: KeyboardEvent): void {
    if (props.mode !== 'multi' || view.value !== 'day') return;
    event.stopPropagation();
    event.preventDefault();
    backToWeek();
}

function onSlot(slot: Slot): void {
    openSlot(slot.level, slot.start);
}

let clock: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
    if (!directions.value.includes(direction.value)) direction.value = directions.value[0] ?? 'heat';
    clock = setInterval(() => (now.value = minutesOf(new Date())), 60_000);
    void load().then(() => {
        if (props.mode === 'simple') openNew();
    });
});
onBeforeUnmount(() => clearInterval(clock));

const programCtl = useProgram(() => props.io);
const paused = computed(() => programCtl.state.value !== undefined && !programCtl.enabled.value);
</script>

<template>
    <div class="schedule" :class="`schedule--${mode}`" @keydown.esc="onEscape">
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

            <div v-if="mode === 'simple' && directions.length > 1" class="schedule__tabs" role="tablist" :aria-label="t('schedule.tabs')">
                <button
                    v-for="d in directions"
                    :key="d"
                    type="button"
                    role="tab"
                    class="schedule__button"
                    :aria-selected="d === direction"
                    @click="selectDirection(d)"
                >
                    {{ dirName(d) }}
                </button>
            </div>

            <ScheduleWeek
                v-if="mode === 'multi' && program && view === 'week'"
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

            <ScheduleDay
                v-else-if="mode === 'multi' && program"
                :program="program"
                :direction="direction"
                :day="day"
                :slots="daySlots"
                :subtitle="subtitle"
                :gap-label="gapLabel"
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
                @open="onSlot"
                @copy="openCopy"
                @set-default="(v) => writeValue(ios[`${direction}_default`], String(v))"
                @set-off="(v) => writeValue(ios.cool_default_off, v ? 'true' : 'false')"
            />

            <p v-if="notice && !form" ref="noticeBox" class="schedule__notice" role="alert">{{ notice }}</p>
            <p v-if="done" class="schedule__muted" role="status">{{ done }}</p>

            <section v-if="copyOpen && mode === 'multi' && view === 'day'" class="schedule__panel" :aria-label="t('schedule.copy.title', { day: dayName(day) })">
                <h3 class="schedule__heading">{{ t('schedule.copy.title', { day: dayName(day) }) }}</h3>
                <div class="schedule__days">
                    <button
                        v-for="d in WEEKDAYS"
                        :key="d"
                        type="button"
                        class="schedule__day"
                        :aria-pressed="copyTargets.includes(d)"
                        :aria-label="dayName(d)"
                        :disabled="d === day"
                        @click="copyTargets = toggle(copyTargets, d)"
                    >
                        {{ t(`schedule.dayShort.${d}`) }}
                    </button>
                </div>
                <div class="schedule__actions">
                    <button type="button" class="schedule__chip" @click="pick(WORKDAYS)">{{ t('schedule.copy.workdays') }}</button>
                    <button type="button" class="schedule__chip" @click="pick(WEEKEND)">{{ t('schedule.copy.weekend') }}</button>
                    <button type="button" class="schedule__chip" @click="pick(WEEKDAYS)">{{ t('schedule.copy.all') }}</button>
                </div>
                <div v-if="confirming" ref="confirmBox" class="schedule__confirm" role="alertdialog" aria-labelledby="schedule-confirm-title" aria-describedby="schedule-confirm-text" tabindex="-1">
                    <h4 id="schedule-confirm-title" class="schedule__heading">{{ t('schedule.copy.confirmTitle') }}</h4>
                    <p id="schedule-confirm-text">{{ confirmText }}</p>
                    <div class="schedule__actions">
                        <button type="button" class="schedule__button" @click="confirming = false">{{ t('schedule.copy.cancel') }}</button>
                        <button type="button" class="schedule__button schedule__button--primary" :disabled="busy" @click="runCopy">
                            {{ t('schedule.copy.replace') }}
                        </button>
                    </div>
                </div>
                <div v-else class="schedule__actions schedule__actions--end">
                    <button type="button" class="schedule__button" @click="copyOpen = false">{{ t('schedule.copy.cancel') }}</button>
                    <button
                        type="button"
                        class="schedule__button schedule__button--primary"
                        :disabled="locked || busy || copyTargets.length === 0"
                        @click="submitCopy"
                    >
                        {{ t('schedule.copy.submit') }}
                    </button>
                </div>
            </section>

            <section v-if="form" class="schedule__panel" :aria-labelledby="'schedule-form-title'">
                <h3 v-if="mode === 'multi'" id="schedule-form-title" class="schedule__heading">
                    {{ form.replacing.length ? t('schedule.form.edit') : t('schedule.form.new') }}
                </h3>
                <h3 v-else id="schedule-form-title" class="schedule__heading">{{ dirName(direction) }}</h3>
                <div v-if="form.level" class="schedule__level">
                    <span>{{ t('schedule.form.level', { n: form.level }) }}</span>
                    <button type="button" class="schedule__chip" :disabled="locked || busy || form.level <= 1" @click="move(-1)">
                        {{ t('schedule.form.raise') }}
                    </button>
                    <button type="button" class="schedule__chip" :disabled="locked || busy || form.level >= levelCount" @click="move(1)">
                        {{ t('schedule.form.lower') }}
                    </button>
                </div>
                <div class="schedule__fields">
                    <label class="schedule__field">
                        <span>{{ t('schedule.form.start') }}</span>
                        <input v-model="form.start" type="time" step="900" required :disabled="locked" @keydown.enter.prevent />
                    </label>
                    <label class="schedule__field">
                        <span>{{ t('schedule.form.end') }}</span>
                        <input v-model="form.end" type="time" step="900" required :disabled="locked" aria-describedby="schedule-end-hint" @keydown.enter.prevent />
                    </label>
                    <label class="schedule__field">
                        <span>{{ t('schedule.form.setpoint') }}</span>
                        <input
                            v-model.number="form.setpoint"
                            type="number"
                            :min="SETPOINT_MIN"
                            :max="SETPOINT_MAX"
                            step="0.5"
                            required
                            :disabled="locked"
                            @keydown.enter.prevent
                        />
                    </label>
                </div>
                <p id="schedule-end-hint" class="schedule__muted">{{ t('schedule.form.endHint') }}</p>
                <fieldset class="schedule__fieldset">
                    <legend>{{ t('schedule.form.days') }}</legend>
                    <div class="schedule__days">
                        <button
                            v-for="d in WEEKDAYS"
                            :key="d"
                            type="button"
                            class="schedule__day"
                            :aria-pressed="form.days.includes(d)"
                            :aria-label="dayName(d)"
                            :disabled="locked"
                            @click="form.days = toggle(form.days, d)"
                        >
                            {{ t(`schedule.dayShort.${d}`) }}
                        </button>
                    </div>
                </fieldset>
                <p v-if="notice" ref="noticeBox" class="schedule__notice" role="alert">{{ notice }}</p>
                <div v-if="mode === 'multi'" class="schedule__actions schedule__actions--end">
                    <button
                        v-if="form.replacing.length"
                        type="button"
                        class="schedule__button schedule__button--danger"
                        :disabled="locked || busy"
                        @click="deleteForm"
                    >
                        {{ t('schedule.form.delete') }}
                    </button>
                    <button type="button" class="schedule__button" @click="form = null">{{ t('schedule.form.cancel') }}</button>
                    <button type="button" class="schedule__button schedule__button--primary" :disabled="locked || busy" @click="saveForm">
                        {{ t('schedule.form.save') }}
                    </button>
                </div>
                <div v-else class="schedule__actions schedule__actions--end">
                    <button type="button" class="schedule__button schedule__button--primary" :disabled="locked || busy" @click="applySimpleForm">
                        {{ t('schedule.simple.apply') }}
                    </button>
                </div>
            </section>

        </template>
    </div>
</template>

<style scoped>
.schedule {
    --lv-h1: #ffe08a;
    --lv-h2: #ffc247;
    --lv-h3: #ff9a3c;
    --lv-h4: #f2693a;
    --lv-h5: #d94a4a;
    --lv-h6: #b3345f;
    --lv-c1: #a6e3f2;
    --lv-c2: #6cc9e6;
    --lv-c3: #38b0d3;
    --lv-c4: #3b8fd0;
    --lv-c5: #4a6fd0;
    --lv-c6: #6a55c4;

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

.schedule__days,
.schedule__actions,
.schedule__level,
.schedule__fields {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
}

.schedule__actions--end {
    justify-content: flex-end;
}

.schedule__day,
.schedule__button,
.schedule__chip {
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

.schedule__days {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: var(--space-1);
}

.schedule__day {
    min-inline-size: 0;
    padding: 0;
}

.schedule__tabs {
    display: flex;
    gap: var(--space-2);
}

.schedule__tabs .schedule__button[aria-selected='true'],
.schedule__day[aria-selected='true'],
.schedule__day[aria-pressed='true'] {
    color: #111;
    background: var(--c-accent);
    border-color: var(--c-accent);
}

.schedule__button--primary {
    color: #111;
    background: var(--c-accent);
    border-color: var(--c-accent);
}

.schedule__button--danger {
    color: var(--c-danger-text);
    border-color: var(--c-danger);
}

.schedule__chip {
    font-size: 0.875rem;
}

button:disabled,
input:disabled {
    cursor: not-allowed;
    opacity: 0.65;
}

.schedule__panel,
.schedule__confirm {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--c-surface-raised);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
}

.schedule__confirm {
    border-color: var(--c-warn-border);
}

.schedule__confirm p {
    margin: 0;
}

.schedule__heading {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
}

.schedule__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: 0.875rem;
    color: var(--c-text-muted);
}

.schedule__field input {
    min-block-size: 2.75rem;
    padding: 0 var(--space-2);
    font: inherit;
    color: var(--c-text);
    background: var(--c-surface);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--radius-sm);
}

.schedule__fieldset {
    margin: 0;
    padding: 0;
    border: 0;
}

.schedule__fieldset legend {
    margin-block-end: var(--space-1);
    font-size: 0.875rem;
    color: var(--c-text-muted);
}

.schedule__check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-block-size: 2.75rem;
}

.schedule__check input {
    inline-size: 1.25rem;
    block-size: 1.25rem;
    accent-color: var(--c-accent);
}
</style>
