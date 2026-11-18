// The time program of one climate device as the card and the detail show it:
// the switch, the active level and the next change. Reading comes from
// `device.state.program`; the only write is `program_enabled`, which the
// server confirms by republishing the climate's state.

import { computed, getCurrentScope, onScopeDispose, ref, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { toValue } from 'vue';
import type { MaybeRefOrGetter } from 'vue';
import { useI18n } from 'vue-i18n';
import { useConnectionStore } from '../stores/connection';
import { useScheduleStore } from '../stores/schedule';
import type { IoItem, ProgramNextChange, ProgramSetState, ProgramState } from '../protocol/types';

/** Same patience as the climate drafts: after this a silent server is a refusing one. */
const DRAFT_TIMEOUT_MS = 5000;
/** The countdown is in minutes; no need to wake more often. */
const TICK_MS = 30_000;

export interface UseProgram {
    /** The device has levels to program (`capabilities.program`). */
    available: ComputedRef<boolean>;
    /** `state.program` has not arrived yet. */
    loading: ComputedRef<boolean>;
    state: ComputedRef<ProgramState | undefined>;
    enabled: ComputedRef<boolean>;
    /** The program cannot be driven from here: offline, or no `program_enabled` IO. */
    readonly: ComputedRef<boolean>;
    saving: Ref<boolean>;
    error: Ref<string>;
    toggle: () => Promise<void>;
    /** The set that applies now: `mode_set`, or the one of `next_change` in auto. */
    current: ComputedRef<ProgramSetState | undefined>;
    /** Clock time of the next change, e.g. `17:30`, with the weekday when it is not today. */
    nextTime: ComputedRef<string>;
    nextChange: ComputedRef<ProgramNextChange | null>;
    /** `3 h 20`, `45 min`, `< 1 min`; empty when nothing is planned. */
    nextIn: ComputedRef<string>;
    /** The one line of the detail ("17:30, Heating level 2 at 20.5° (in 3 h 20)"). */
    nextText: ComputedRef<string>;
    /** "Level 2 · 20.5°", or that no level applies now. */
    activeText: ComputedRef<string>;
    /** Heating/cooling in play now, for the pause banner. */
    pausedText: ComputedRef<string>;
}

export function useProgram(io: MaybeRefOrGetter<IoItem>): UseProgram {
    const { t, locale } = useI18n();
    const store = useScheduleStore();
    const connection = useConnectionStore();

    const device = computed(() => toValue(io).device);
    const state = computed(() => device.value?.state?.program);
    const available = computed(() => device.value?.capabilities?.program !== undefined);
    const loading = computed(() => available.value && state.value === undefined);
    const enabledId = computed(() => device.value?.ios.program_enabled ?? '');

    const draft = ref<boolean | null>(null);
    const saving = ref(false);
    const error = ref('');
    let timer: ReturnType<typeof setTimeout> | undefined;

    const enabled = computed(() => draft.value ?? state.value?.enabled ?? false);
    const readonly = computed(() => !connection.isOpen || enabledId.value === '');

    function clearDraft() {
        draft.value = null;
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
    }

    // The server's word replaces the draft, whatever it says.
    watch(
        () => state.value?.enabled,
        () => {
            if (!saving.value) clearDraft();
        },
    );

    async function toggle(): Promise<void> {
        if (readonly.value || saving.value || state.value === undefined) return;
        const next = !enabled.value;
        draft.value = next;
        saving.value = true;
        error.value = '';
        const failure = await store.writeValue(enabledId.value, next ? 'true' : 'false');
        saving.value = false;
        if (failure !== '') {
            clearDraft();
            error.value = failure === 'offline' ? t('program.error.offline') : t('program.error.generic');
            return;
        }
        if (state.value?.enabled === next) clearDraft();
        else {
            if (timer !== undefined) clearTimeout(timer);
            timer = setTimeout(clearDraft, DRAFT_TIMEOUT_MS);
        }
    }

    // ---------------------------------------------------------- the clock ---

    const now = ref(Date.now());
    const nextChange = computed(() => state.value?.nextChange ?? null);
    let ticker: ReturnType<typeof setInterval> | undefined;

    function stopTicker() {
        if (ticker !== undefined) clearInterval(ticker);
        ticker = undefined;
    }

    watch(
        nextChange,
        (change) => {
            if (!change) {
                stopTicker();
                return;
            }
            now.value = Date.now();
            ticker ??= setInterval(() => (now.value = Date.now()), TICK_MS);
        },
        { immediate: true },
    );

    if (getCurrentScope()) {
        onScopeDispose(() => {
            stopTicker();
            if (timer !== undefined) clearTimeout(timer);
        });
    }

    const nextDate = computed(() => (nextChange.value ? new Date(nextChange.value.at) : undefined));

    const nextTime = computed(() => {
        const at = nextDate.value;
        if (!at) return '';
        const clock = at.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit', hour12: false });
        const today = new Date(now.value);
        if (at.toDateString() === today.toDateString()) return clock;
        return `${at.toLocaleDateString(locale.value, { weekday: 'short' })} ${clock}`;
    });

    const nextIn = computed(() => {
        const at = nextDate.value;
        if (!at) return '';
        const minutes = Math.max(0, Math.round((at.getTime() - now.value) / 60_000));
        if (minutes < 1) return t('program.lessThanAMinute');
        const days = Math.floor(minutes / 1440);
        const hours = Math.floor((minutes % 1440) / 60);
        const rest = minutes % 60;
        if (days > 0) return t('program.inDays', { days, hours });
        if (hours > 0) return t('program.inHours', { hours, minutes: String(rest).padStart(2, '0') });
        return t('program.inMinutes', { minutes: rest });
    });

    function degrees(value: number | null): string {
        return value === null ? '' : value.toLocaleString(locale.value, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
    }

    const nextText = computed(() => {
        const change = nextChange.value;
        if (!change) return t('program.nothingNext');
        const dir = t(`schedule.${change.set}`);
        // A null level is the default setpoint taking over; only a null setpoint is "off".
        const what =
            change.setpoint === null
                ? t('program.nextOff', { dir })
                : change.level === null
                  ? t('program.nextDefault', { dir, setpoint: degrees(change.setpoint) })
                  : t('program.nextLevel', { dir, level: change.level, setpoint: degrees(change.setpoint) });
        return t('program.next', { time: nextTime.value, what, in: nextIn.value });
    });

    const current = computed(() => {
        const s = state.value;
        if (!s) return undefined;
        const set = s.modeSet === 'heat' || s.modeSet === 'cool' ? s.modeSet : (nextChange.value?.set ?? (s.heat ? 'heat' : 'cool'));
        return s[set];
    });

    const activeText = computed(() => {
        const set = current.value;
        if (!set || set.setpoint === null) return t('program.noLevel');
        if (set.activeLevel === null) return t('program.activeDefault', { setpoint: degrees(set.setpoint) });
        return t('program.activeLevel', { level: set.activeLevel, setpoint: degrees(set.setpoint) });
    });

    const pausedText = computed(() => {
        const set = current.value;
        if (!set || set.setpoint === null) return t('program.paused');
        if (set.activeLevel === null) return t('program.pausedDefault', { setpoint: degrees(set.setpoint) });
        return t('program.pausedLevel', { level: set.activeLevel, setpoint: degrees(set.setpoint) });
    });

    return { available, loading, state, enabled, readonly, saving, error, toggle, current, now, nextTime, nextChange, nextIn, nextText, activeText, pausedText };
}
