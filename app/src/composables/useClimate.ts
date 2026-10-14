// Everything the climate row and its detail view share: what the device says,
// what the user has just chosen, and the commands that go out.
//
// Commands go out through `set_state` (spec §5.2): a plain mode for the mode
// choice, a JSON partial update for everything else. Like the rest of the
// app nothing is optimistic — the values on screen stay the server's — with
// one exception: a value the user has just chosen stays on screen (the
// "draft") until the server answers, so a +/- tap does not snap back for the
// round trip. Setpoint, fan and swing changes are debounced into one merged
// command; see useDebouncedMerge.

import { computed, getCurrentScope, onScopeDispose, ref, watch } from 'vue';
import type { ComputedRef, MaybeRefOrGetter } from 'vue';
import { toValue } from 'vue';
import { useDebouncedMerge } from './useDebouncedMerge';
import { useIo } from './useIo';
import { atRangeStop, climateGating, climateStatus, moveRangeHandle, snapToStep } from '../protocol/climate';
import type { ClimateGating, ClimateStatus } from '../protocol/climate';
import type { DeviceCapabilities, DeviceInfo, DeviceState, DeviceTargetTemp, IoItem } from '../protocol/types';

/** Quiet period before a burst of setpoint/fan/swing changes becomes one command. */
const DEBOUNCE_MS = 350;

/** Matches the store's pending timeout: after this a silent server is a refusing one. */
const DRAFT_TIMEOUT_MS = 5000;

interface ClimatePatch {
    target_temp: number;
    target_temp_low: number;
    target_temp_high: number;
    fan_mode: string;
    swing_mode: string;
}

type Field = keyof ClimatePatch;

interface InFlight {
    sent: Partial<ClimatePatch>;
    /** The fields of `sent` still waiting for the server to report something. */
    pending: Set<Field>;
    timer?: ReturnType<typeof setTimeout>;
}

const FIELDS: Field[] = ['target_temp', 'target_temp_low', 'target_temp_high', 'fan_mode', 'swing_mode'];

export interface UseClimate {
    device: ComputedRef<DeviceInfo | undefined>;
    caps: ComputedRef<DeviceCapabilities | undefined>;
    state: ComputedRef<DeviceState | undefined>;
    bounds: ComputedRef<DeviceTargetTemp | undefined>;
    gating: ComputedRef<ClimateGating | undefined>;
    status: ComputedRef<ClimateStatus | undefined>;
    /** Share of the lock-out already waited, 0..1; only meaningful while locked out. */
    lockoutElapsed: ComputedRef<number>;
    isPending: ComputedRef<boolean>;
    modes: ComputedRef<string[]>;
    /** '' is the server's "mode not known yet" — not `off`. */
    mode: ComputedRef<string>;
    single: ComputedRef<number | undefined>;
    low: ComputedRef<number | undefined>;
    high: ComputedRef<number | undefined>;
    /** The inner −/+ pair is refused: low and high are `min_range` apart. */
    rangeStop: ComputedRef<boolean>;
    fan: ComputedRef<string>;
    swing: ComputedRef<string>;
    nudge: (direction: 1 | -1) => void;
    nudgeRange: (which: 'low' | 'high', direction: 1 | -1) => void;
    selectMode: (next: string) => void;
    setOption: (field: 'fan_mode' | 'swing_mode', value: string) => void;
}

export function useClimate(io: MaybeRefOrGetter<IoItem>): UseClimate {
    const { isPending, set } = useIo(() => toValue(io).id);

    const device = computed(() => {
        const d = toValue(io).device;
        return d?.family === 'climate' ? d : undefined;
    });
    const caps = computed(() => device.value?.capabilities);
    const state = computed(() => device.value?.state);
    const bounds = computed(() => caps.value?.targetTemp);
    const gating = computed(() => (device.value ? climateGating(device.value) : undefined));
    const modes = computed(() => caps.value?.modes ?? []);
    const mode = computed(() => state.value?.mode ?? '');

    // ------------------------------------------------------------ lock-out ---

    // The server publishes the seconds left once; the countdown is ours.
    const now = ref(Date.now());
    const lockoutEnd = ref<number | null>(null);
    const lockoutTotal = ref(0);
    let ticker: ReturnType<typeof setInterval> | undefined;

    function stopTicker() {
        if (ticker !== undefined) clearInterval(ticker);
        ticker = undefined;
    }

    watch(
        () => state.value?.lockout,
        (lockout) => {
            if (!lockout) {
                lockoutEnd.value = null;
                lockoutTotal.value = 0;
                stopTicker();
                return;
            }
            now.value = Date.now();
            lockoutEnd.value = now.value + lockout.remaining * 1000;
            // The wire has no total: the first remaining seen is the best one.
            lockoutTotal.value = Math.max(lockoutTotal.value, lockout.remaining);
            ticker ??= setInterval(() => {
                now.value = Date.now();
                if (lockoutEnd.value !== null && lockoutEnd.value <= now.value) stopTicker();
            }, 1000);
        },
        { immediate: true },
    );

    const lockoutSeconds = computed(() =>
        lockoutEnd.value === null ? undefined : Math.max(0, Math.ceil((lockoutEnd.value - now.value) / 1000)),
    );
    const lockoutElapsed = computed(() => {
        const left = lockoutSeconds.value;
        if (left === undefined || lockoutTotal.value <= 0) return 0;
        return Math.min(1, Math.max(0, 1 - left / lockoutTotal.value));
    });

    const status = computed(() => (device.value ? climateStatus(device.value, lockoutSeconds.value) : undefined));

    // -------------------------------------------------------------- drafts ---

    const draft = ref<Partial<ClimatePatch>>({});

    function serverValue(field: Field): number | string | undefined {
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

    let inFlight: InFlight[] = [];
    /** Each field as the server last reported it: what a change is measured against. */
    const known: Partial<Record<Field, number | string | undefined>> = {};
    for (const f of FIELDS) known[f] = serverValue(f);
    const draftTimers = new Set<ReturnType<typeof setTimeout>>();

    function dropDraft(sent: Partial<ClimatePatch>, fields?: Iterable<Field>) {
        const next = { ...draft.value };
        for (const field of fields ?? (Object.keys(sent) as Field[])) {
            // A newer choice on the same field is not this command's to retire.
            if (next[field] === sent[field]) delete next[field];
        }
        draft.value = next;
    }

    /**
     * Ends a command's claim on its draft — except for a field a newer command
     * still waits on: that command may have sent the very same value, and its
     * draft is what the screen should keep showing until it is answered.
     */
    function releaseDraft(entry: InFlight, fields: Iterable<Field>) {
        const newer = inFlight.slice(inFlight.indexOf(entry) + 1);
        dropDraft(
            entry.sent,
            [...fields].filter((f) => !newer.some((e) => e.pending.has(f))),
        );
    }

    function retire(entry: InFlight) {
        if (entry.timer !== undefined) {
            clearTimeout(entry.timer);
            draftTimers.delete(entry.timer);
        }
        releaseDraft(entry, Object.keys(entry.sent) as Field[]);
        inFlight = inFlight.filter((e) => e !== entry);
    }

    const commands = useDebouncedMerge<ClimatePatch>((merged) => {
        // What the server is about to hold for a field: the last command in
        // flight for it, else what it reports. A field that already has that
        // value waits for nothing.
        const expected = (f: Field) => [...inFlight].reverse().find((e) => e.pending.has(f))?.sent[f] ?? known[f];
        const fields = (Object.keys(merged) as Field[]).filter((f) => merged[f] !== expected(f));
        const entry: InFlight = { sent: merged, pending: new Set(fields) };
        // A refusal changes nothing on the server, so the republished device
        // looks like any unrelated update: only the verdict can end the draft
        // early.
        const sentOk = set(JSON.stringify(merged), (success) => {
            if (!success) retire(entry);
        });
        if (!sentOk) {
            dropDraft(merged);
            return;
        }
        // A value the server already has, and no command pending on it, needs
        // no draft to bridge the round trip.
        dropDraft(
            merged,
            (Object.keys(merged) as Field[]).filter(
                (f) => !entry.pending.has(f) && !inFlight.some((e) => e.pending.has(f)),
            ),
        );
        if (entry.pending.size === 0) return;
        inFlight.push(entry);
        // Rejected or ignored commands never change the server's value: the
        // draft must not outlive the store's own pending timeout.
        const timer = setTimeout(() => retire(entry), DRAFT_TIMEOUT_MS);
        draftTimers.add(timer);
        entry.timer = timer;
    }, DEBOUNCE_MS);

    function queue(patch: Partial<ClimatePatch>) {
        draft.value = { ...draft.value, ...patch };
        commands.push(patch);
    }

    // The device arrives whole on every io_changed, including ones that only
    // move current_temp: a draft ends when the server reports a different
    // value for its own field, not when anything arrives.
    //
    // A new value either is the answer to one of the commands in flight for
    // that field — then it and every earlier one are done, later ones still
    // wait — or it is nobody's answer (another client, or the server bounding
    // what was asked): then the server wins over all of them.
    watch(
        () => toValue(io).device,
        () => {
            for (const f of FIELDS) {
                const value = serverValue(f);
                if (value === known[f]) continue;
                known[f] = value;
                const waiting = inFlight.filter((e) => e.pending.has(f));
                const answered = waiting.findIndex((e) => e.sent[f] === value);
                const done = answered === -1 ? waiting : waiting.slice(0, answered + 1);
                for (const entry of done) entry.pending.delete(f);
                for (const entry of done) releaseDraft(entry, [f]);
            }
            for (const entry of inFlight.filter((e) => e.pending.size === 0)) retire(entry);
        },
    );

    if (getCurrentScope()) {
        onScopeDispose(() => {
            for (const timer of draftTimers) clearTimeout(timer);
            stopTicker();
        });
    }

    // --------------------------------------------------------------- modes ---

    // The mode this view asked for and has not seen answered. While it is out,
    // the displayed mode is a legitimate target again: choosing it takes the
    // request back.
    const modeInFlight = ref<string | null>(null);
    watch(isPending, (pending) => {
        if (!pending) modeInFlight.value = null;
    });

    function selectMode(next: string) {
        if (next === mode.value && modeInFlight.value === null) return;
        // The mode must not overtake a setpoint the user chose just before it.
        commands.flush();
        if (set(next)) modeInFlight.value = next;
    }

    // ------------------------------------------------------------ setpoint ---

    const single = computed(() => draft.value.target_temp ?? state.value?.targetTemp);
    const low = computed(() => draft.value.target_temp_low ?? state.value?.targetTempLow);
    const high = computed(() => draft.value.target_temp_high ?? state.value?.targetTempHigh);
    const rangeStop = computed(() => atRangeStop(low.value, high.value, bounds.value?.minRange));

    function nudge(direction: 1 | -1) {
        const b = bounds.value;
        if (!b) return;
        const base = single.value ?? (direction === 1 ? b.min : b.max);
        const next = snapToStep(base + direction * b.step, b);
        if (next !== single.value) queue({ target_temp: next });
    }

    function nudgeRange(which: 'low' | 'high', direction: 1 | -1) {
        const b = bounds.value;
        // The server refuses a partial range, so a half-known one is not editable.
        if (!b || low.value === undefined || high.value === undefined) return;
        const current = { low: low.value, high: high.value };
        const next = moveRangeHandle(which, current[which] + direction * b.step, current, b);
        if (next.low === current.low && next.high === current.high) return;
        queue({ target_temp_low: next.low, target_temp_high: next.high });
    }

    // ----------------------------------------------------------- fan, swing ---

    const fan = computed(() => draft.value.fan_mode ?? state.value?.fanMode ?? '');
    const swing = computed(() => draft.value.swing_mode ?? state.value?.swingMode ?? '');

    function setOption(field: 'fan_mode' | 'swing_mode', value: string) {
        queue({ [field]: value });
    }

    return {
        device,
        caps,
        state,
        bounds,
        gating,
        status,
        lockoutElapsed,
        isPending,
        modes,
        mode,
        single,
        low,
        high,
        rangeStop,
        fan,
        swing,
        nudge,
        nudgeRange,
        selectMode,
        setOption,
    };
}
