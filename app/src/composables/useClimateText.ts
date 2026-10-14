// The words and numbers the row and the detail view both print.

import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';
import type { UseClimate } from './useClimate';
import { formatTemp, splitDuration } from '../protocol/climate';
import type { ClimateStatus } from '../protocol/climate';

export interface ClimateText {
    /** The status in full, as the detail view says it ("Starts in 2 min 20"). */
    status: ComputedRef<string>;
    /** The same for a row, where room is tight ("Waiting"). */
    statusShort: ComputedRef<string>;
    /** `22°`, `21 – 23°`, `--` when never received, empty where there is no setpoint to show. */
    setpoint: ComputedRef<string>;
    /** `Room 25.4°`, empty when the temperature was never received. */
    room: ComputedRef<string>;
    degrees: (value: number | undefined) => string;
    modeLabel: (mode: string) => string;
}

export function useClimateText(ctl: UseClimate): ClimateText {
    const { t, te, locale } = useI18n();

    const step = computed(() => ctl.bounds.value?.step ?? 0.5);
    const degrees = (value: number | undefined): string =>
        value === undefined ? '--' : `${formatTemp(value, step.value, locale.value)}°`;

    function lookup(group: string, id: string, params?: Record<string, string>): string | undefined {
        const key = `climate.${group}.${id}`;
        return te(key) ? t(key, params ?? {}) : undefined;
    }

    function duration(seconds: number): string {
        const { minutes, seconds: rest } = splitDuration(seconds);
        return minutes > 0
            ? t('climate.duration.minutes', { minutes, seconds: String(rest).padStart(2, '0') })
            : t('climate.duration.seconds', { seconds: rest });
    }

    function say(status: ClimateStatus, short: boolean): string {
        switch (status.id) {
            case 'fault':
                return lookup('fault', status.fault ?? '') ?? t('climate.status.fault');
            case 'mode':
                return lookup('mode', ctl.mode.value) ?? ctl.mode.value;
            case 'lockout':
                return short
                    ? t('climate.statusShort.lockout')
                    : t('climate.status.lockout', { time: duration(status.seconds ?? 0) });
            default:
                return (short ? lookup('statusShort', status.id) : undefined) ?? t(`climate.status.${status.id}`);
        }
    }

    const modeLabel = (mode: string): string => lookup('mode', mode === '' ? 'unknown' : mode) ?? mode;

    return {
        status: computed(() => (ctl.status.value ? say(ctl.status.value, false) : '')),
        statusShort: computed(() => (ctl.status.value ? say(ctl.status.value, true) : '')),
        setpoint: computed(() => {
            const kind = ctl.gating.value?.setpoint;
            if (kind === 'none') return '';
            if (kind !== 'range') return degrees(ctl.single.value);
            const { low, high } = ctl;
            if (low.value === undefined || high.value === undefined) return '--';
            return `${formatTemp(low.value, step.value, locale.value)} – ${degrees(high.value)}`;
        }),
        room: computed(() => {
            const current = ctl.state.value?.currentTemp;
            return current === undefined ? '' : t('climate.room', { temp: degrees(current) });
        }),
        degrees,
        modeLabel,
    };
}
