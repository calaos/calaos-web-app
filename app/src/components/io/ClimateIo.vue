<script setup lang="ts">
// `climate` — one widget for the whole device family, drawn only from the
// `device` object: which controls exist is `capabilities`, what they show is
// `state`. Nothing here knows about proxies or thermostats.
//
// Commands go out through `set_state` (spec §5.2): a plain mode for the mode
// buttons, a JSON partial update for everything else. Like the rest of the
// app the row is not optimistic — the values on screen stay the server's — with
// one exception: a value the user has just chosen stays on screen (the
// "draft") until the server answers, so a +/- tap or a slider release does not
// snap back for the round trip. Setpoint, fan and swing changes are debounced
// into one merged command; see useDebouncedMerge.

import { computed, onScopeDispose, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import IconThermostat from '~icons/mdi/thermostat';
import ActionButton from './ActionButton.vue';
import { BUTTONS } from './calaos-icons';
import IoRowFrame from './IoRowFrame.vue';
import BaseSlider from '../ui/BaseSlider.vue';
import RangeSlider from '../ui/RangeSlider.vue';
import { useDebouncedMerge } from '../../composables/useDebouncedMerge';
import { useIo } from '../../composables/useIo';
import { climateGating, formatSetpoint, snapToStep } from '../../protocol/climate';
import type { Range } from '../../protocol/climate';
import type { DeviceTargetTemp, IoItem } from '../../protocol/types';

/** Quiet period before a burst of setpoint/fan/swing changes becomes one command. */
const DEBOUNCE_MS = 350;

/** Matches the store's pending timeout: after this a silent server is a refusing one. */
const DRAFT_TIMEOUT_MS = 5000;

/** Fields the JSON partial update can carry from this widget. */
interface ClimatePatch {
    target_temp: number;
    target_temp_low: number;
    target_temp_high: number;
    fan_mode: string;
    swing_mode: string;
}

const ACTIVE_ACTIONS = new Set(['heating', 'cooling', 'drying', 'fan']);

const props = defineProps<{ io: IoItem }>();

const { t, te } = useI18n();
const { isPending, set } = useIo(() => props.io.id);
const uid = useId();

const device = computed(() => (props.io.device?.family === 'climate' ? props.io.device : undefined));
const caps = computed(() => device.value?.capabilities);
const state = computed(() => device.value?.state);
const bounds = computed<DeviceTargetTemp | undefined>(() => caps.value?.targetTemp);
const gating = computed(() => (device.value ? climateGating(device.value) : undefined));

const unit = computed(() => (bounds.value?.unit ? bounds.value.unit : '°C'));
const modes = computed(() => caps.value?.modes ?? []);
// '' is the server's "mode not known yet" — not `off`.
const mode = computed(() => state.value?.mode ?? '');

function label(group: 'mode' | 'action' | 'option', value: string): string {
    const key = `climate.${group}.${value}`;
    return te(key) ? t(key) : value;
}

// ---------------------------------------------------------------- drafts ---

const draft = ref<Partial<ClimatePatch>>({});
const previewSingle = ref<number | null>(null);
const previewRange = ref<Range | null>(null);

/** The server's value for a patch field, as the device reports it right now. */
function serverValue(field: keyof ClimatePatch): number | string | undefined {
    const s = state.value;
    switch (field) {
        case 'target_temp':
            return s?.targetTemp;
        case 'target_temp_low':
            return s?.targetTempLow;
        case 'target_temp_high':
            return s?.targetTempHigh;
        case 'fan_mode':
            return s?.fanMode;
        case 'swing_mode':
            return s?.swingMode;
    }
}

interface InFlight {
    /** What the server reported when the command left, per field. */
    base: Partial<Record<keyof ClimatePatch, number | string | undefined>>;
    sent: Partial<ClimatePatch>;
    timer?: ReturnType<typeof setTimeout>;
}

let inFlight: InFlight[] = [];
const draftTimers = new Set<ReturnType<typeof setTimeout>>();

function dropDraft(sent: Partial<ClimatePatch>, fields?: Iterable<keyof ClimatePatch>) {
    const next = { ...draft.value };
    for (const field of fields ?? (Object.keys(sent) as (keyof ClimatePatch)[])) {
        // A newer choice on the same field is not this command's to retire.
        if (next[field] === sent[field]) delete next[field];
    }
    draft.value = next;
}

function retire(entry: InFlight) {
    if (entry.timer !== undefined) {
        clearTimeout(entry.timer);
        draftTimers.delete(entry.timer);
    }
    inFlight = inFlight.filter((e) => e !== entry);
    dropDraft(entry.sent);
}

const commands = useDebouncedMerge<ClimatePatch>((merged) => {
    const fields = Object.keys(merged) as (keyof ClimatePatch)[];
    const entry: InFlight = {
        base: Object.fromEntries(fields.map((f) => [f, serverValue(f)])),
        sent: merged,
    };
    // A refusal changes nothing on the server, so the republished device looks
    // like any unrelated update: only the verdict can end the draft early.
    const sentOk = set(JSON.stringify(merged), (success) => {
        if (!success) retire(entry);
    });
    if (!sentOk) {
        dropDraft(merged);
        return;
    }
    inFlight.push(entry);
    // Rejected or ignored commands never change the server's value: the draft
    // must not outlive the store's own pending timeout.
    const timer = setTimeout(() => retire(entry), DRAFT_TIMEOUT_MS);
    draftTimers.add(timer);
    entry.timer = timer;
}, DEBOUNCE_MS);

function queue(patch: Partial<ClimatePatch>) {
    draft.value = { ...draft.value, ...patch };
    commands.push(patch);
}

// The device arrives whole on every io_changed, including ones that only move
// current_temp: a draft ends when the server reports a different value for
// its own field, not when anything arrives.
watch(
    () => props.io.device,
    () => {
        for (const entry of inFlight) {
            const answered = (Object.keys(entry.sent) as (keyof ClimatePatch)[]).filter(
                (f) => serverValue(f) !== entry.base[f],
            );
            if (answered.length === 0) continue;
            dropDraft(entry.sent, answered);
            for (const f of answered) delete entry.base[f];
        }
        inFlight = inFlight.filter((e) => Object.keys(e.base).length > 0);
    },
);

onScopeDispose(() => {
    for (const timer of draftTimers) clearTimeout(timer);
});

// ----------------------------------------------------------------- modes ---

// The mode this widget asked for and has not seen answered. While it is out,
// the displayed mode is a legitimate target again: clicking it takes the
// request back.
const modeInFlight = ref<string | null>(null);
watch(isPending, (now) => {
    if (!now) modeInFlight.value = null;
});

function selectMode(next: string) {
    if (next === mode.value && modeInFlight.value === null) return;
    // The mode must not overtake a setpoint the user chose just before it.
    commands.flush();
    if (set(next)) modeInFlight.value = next;
}

const modeUnselected = computed(() => !modes.value.includes(mode.value));

// -------------------------------------------------------------- readings ---

const currentTemp = computed(() => {
    const value = state.value?.currentTemp;
    return value === undefined ? '—' : `${value.toFixed(1)} ${unit.value}`;
});

const action = computed(() => (caps.value?.reportsAction ? state.value?.action : undefined));
const actionActive = computed(() => action.value !== undefined && ACTIVE_ACTIONS.has(action.value));

// -------------------------------------------------------------- setpoint ---

const singleValue = computed(
    () => previewSingle.value ?? draft.value.target_temp ?? state.value?.targetTemp,
);

// What the slider is told: never the live drag, or its own follow-the-server
// logic would only ever see its own movement.
const rangeLow = computed(() => draft.value.target_temp_low ?? state.value?.targetTempLow);
const rangeHigh = computed(() => draft.value.target_temp_high ?? state.value?.targetTempHigh);

function fmt(value: number | undefined): string {
    return value === undefined || !bounds.value ? '—' : formatSetpoint(value, bounds.value.step);
}

const singleText = computed(() => `${fmt(singleValue.value)} ${unit.value}`);
// The server refuses a partial range, so a half-known one is shown, not editable.
const rangeKnown = computed(() => rangeLow.value !== undefined && rangeHigh.value !== undefined);
const rangeText = computed(
    () =>
        `${fmt(previewRange.value?.low ?? rangeLow.value)} – ${fmt(previewRange.value?.high ?? rangeHigh.value)} ${unit.value}`,
);

function nudge(direction: 1 | -1) {
    const b = bounds.value;
    if (!b) return;
    const base = singleValue.value ?? (direction === 1 ? b.min : b.max);
    const next = snapToStep(base + direction * b.step, b);
    if (next !== singleValue.value) queue({ target_temp: next });
}

function commitRange(range: Range) {
    queue({ target_temp_low: range.low, target_temp_high: range.high });
}

// ------------------------------------------------------------ fan, swing ---

const fanId = `climate-fan-${uid}`;
const swingId = `climate-swing-${uid}`;

const fanValue = computed(() => draft.value.fan_mode ?? state.value?.fanMode ?? '');
const swingValue = computed(() => draft.value.swing_mode ?? state.value?.swingMode ?? '');

/** The list, plus the current value if the server holds one outside it. */
function optionsFor(list: string[] | undefined, current: string): string[] {
    const base = list ?? [];
    return current !== '' && !base.includes(current) ? [...base, current] : base;
}

function onSelect(field: 'fan_mode' | 'swing_mode', event: Event) {
    queue({ [field]: (event.target as HTMLSelectElement).value });
}
</script>

<template>
    <IoRowFrame :name="io.name" :status="io.status" :pending="isPending">
        <template #icon>
            <IconThermostat
                class="climate-io__icon"
                :class="{ 'climate-io__icon--on': actionActive }"
                aria-hidden="true"
            />
        </template>
        <template #value>
            <span
                v-if="device && action !== undefined"
                class="climate-io__chip"
                :class="{ 'climate-io__chip--active': actionActive }"
            >
                {{ label('action', action) }}
            </span>
            <span v-if="device" class="climate-io__current">
                <span class="visually-hidden">
                    {{ state?.currentTemp === undefined ? t('climate.currentUnknown') : t('climate.current') }}
                </span>
                {{ currentTemp }}
            </span>
            <span v-else>{{ io.state }}</span>
        </template>

        <template v-if="device" #panel>
            <div class="climate-io__panel" :class="{ 'climate-io__panel--off': gating?.off }">
                <div class="climate-io__head">
                    <div
                        v-if="modes.length > 0"
                        class="climate-io__modes"
                        role="group"
                        :aria-label="t('climate.modes', { name: io.name })"
                    >
                        <button
                            v-for="m in modes"
                            :key="m"
                            type="button"
                            class="climate-io__mode"
                            :aria-pressed="m === mode"
                            @click="selectMode(m)"
                        >
                            {{ label('mode', m) }}
                        </button>
                    </div>
                    <span v-if="modeUnselected" class="climate-io__chip climate-io__chip--unknown">
                        {{ mode === '' ? t('climate.mode.unknown') : label('mode', mode) }}
                    </span>
                </div>

                <div
                    v-if="bounds && gating?.setpoint === 'single'"
                    class="climate-io__setpoint"
                    :class="{ 'climate-io__setpoint--off': gating.off }"
                >
                    <div class="climate-io__dial">
                        <ActionButton
                            :label="t('climate.lower', { name: io.name })"
                            :face="BUTTONS.minus"
                            :disabled="gating.off || (singleValue !== undefined && singleValue <= bounds.min)"
                            @click="nudge(-1)"
                        />
                        <output class="climate-io__target">{{ singleText }}</output>
                        <ActionButton
                            :label="t('climate.raise', { name: io.name })"
                            :face="BUTTONS.plus"
                            :disabled="gating.off || (singleValue !== undefined && singleValue >= bounds.max)"
                            @click="nudge(1)"
                        />
                    </div>
                    <BaseSlider
                        class="climate-io__slider"
                        :model-value="singleValue ?? bounds.min"
                        :min="bounds.min"
                        :max="bounds.max"
                        :step="bounds.step"
                        :label="t('climate.target', { name: io.name })"
                        :aria-valuetext="singleText"
                        :disabled="gating.off"
                        @live="previewSingle = $event"
                        @commit="queue({ target_temp: $event })"
                    />
                </div>

                <div
                    v-else-if="bounds && gating?.setpoint === 'range'"
                    class="climate-io__setpoint"
                    :class="{ 'climate-io__setpoint--off': gating.off || !rangeKnown }"
                >
                    <div class="climate-io__dial">
                        <output class="climate-io__target">{{ rangeText }}</output>
                    </div>
                    <RangeSlider
                        :low="rangeLow ?? bounds.min"
                        :high="rangeHigh ?? bounds.max"
                        :bounds="bounds"
                        :label-low="t('climate.targetLow', { name: io.name })"
                        :label-high="t('climate.targetHigh', { name: io.name })"
                        :disabled="gating.off || !rangeKnown"
                        @live="previewRange = $event"
                        @commit="commitRange"
                    />
                </div>

                <div v-if="caps?.fanModes?.length || caps?.swingModes?.length" class="climate-io__selects">
                    <div v-if="caps?.fanModes?.length" class="climate-io__field">
                        <label :for="fanId">
                            {{ t('climate.fan') }}<span class="visually-hidden">{{ ' ' + io.name }}</span>
                        </label>
                        <select
                            :id="fanId"
                            class="climate-io__select"
                            :value="fanValue"
                            :disabled="gating?.off"
                            @change="onSelect('fan_mode', $event)"
                        >
                            <option v-if="fanValue === ''" value="" disabled>—</option>
                            <option v-for="o in optionsFor(caps.fanModes, fanValue)" :key="o" :value="o">
                                {{ label('option', o) }}
                            </option>
                        </select>
                    </div>
                    <div v-if="caps?.swingModes?.length" class="climate-io__field">
                        <label :for="swingId">
                            {{ t('climate.swing') }}<span class="visually-hidden">{{ ' ' + io.name }}</span>
                        </label>
                        <select
                            :id="swingId"
                            class="climate-io__select"
                            :value="swingValue"
                            :disabled="gating?.off"
                            @change="onSelect('swing_mode', $event)"
                        >
                            <option v-if="swingValue === ''" value="" disabled>—</option>
                            <option v-for="o in optionsFor(caps.swingModes, swingValue)" :key="o" :value="o">
                                {{ label('option', o) }}
                            </option>
                        </select>
                    </div>
                </div>
            </div>
        </template>
    </IoRowFrame>
</template>

<style scoped>
.climate-io__icon {
    color: var(--c-text-muted);
    transition: color 500ms ease;
}

/* Cyan means "doing something" in this app; the chip says what. */
.climate-io__icon--on {
    color: var(--c-accent);
    filter: drop-shadow(0 0 6px var(--c-accent-glow));
}

.climate-io__current {
    margin-inline-start: var(--space-2);
    color: var(--c-text);
}

/* Same rail as RangeSlider, so the width does not jump between heat and auto. */
.climate-io__setpoint .climate-io__slider {
    inline-size: calc(100% - 1rem);
    margin-inline: 0.5rem;
}

.climate-io__panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.climate-io__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-3);
}

.climate-io__modes {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}

.climate-io__mode {
    min-block-size: 2.75rem;
    min-inline-size: 2.75rem;
    padding-inline: var(--space-3);
    font-size: 0.875rem;
    background: var(--c-surface-raised);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition:
        transform var(--press-duration) ease,
        border-color 160ms ease,
        background-color 160ms ease;
}

.climate-io__mode:active {
    transform: scale(var(--press-scale));
}

.climate-io__mode[aria-pressed='true'] {
    color: var(--c-accent);
    border-color: var(--c-accent);
    background: color-mix(in srgb, var(--c-accent) 14%, var(--c-surface-raised));
    box-shadow: 0 0 8px var(--c-accent-glow);
}

.climate-io__chip {
    display: inline-block;
    padding: 0.125rem var(--space-2);
    line-height: 1.4;
    font-size: 0.8125rem;
    color: var(--c-text-muted);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-lg);
    white-space: nowrap;
}

.climate-io__chip--active {
    color: var(--c-accent);
    border-color: var(--c-accent);
}

.climate-io__chip--unknown {
    color: var(--c-warn);
    border-color: var(--c-warn);
}

.climate-io__setpoint {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    transition: opacity 200ms ease;
}

/* Greyed, not hidden: the user can still see what the setpoint is while off. */
.climate-io__setpoint--off {
    opacity: 0.45;
}

.climate-io__dial {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
}

/* The one loud thing in the row: the number a person came to read or change. */
.climate-io__target {
    min-inline-size: 7rem;
    font-size: 1.75rem;
    font-weight: 500;
    letter-spacing: var(--tracking-tight);
    font-variant-numeric: tabular-nums;
    text-align: center;
}

.climate-io__selects {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
}

.climate-io__field {
    display: flex;
    flex: 1 1 11rem;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.8125rem;
    color: var(--c-text-muted);
}

.climate-io__field label {
    /* Both selects start at the same x when the fields stack on a phone. */
    min-inline-size: 4.5rem;
}

.climate-io__select {
    flex: 1;
    min-inline-size: 0;
    min-block-size: 2.75rem;
    padding-inline: var(--space-2);
    font-size: 0.9375rem;
    color: var(--c-text);
    background: var(--c-surface-raised);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
}

.climate-io__panel--off .climate-io__field {
    opacity: 0.45;
}

@media (prefers-reduced-motion: reduce) {
    .climate-io__icon,
    .climate-io__mode,
    .climate-io__setpoint {
        transition: none;
    }
}
</style>
