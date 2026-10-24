// Dates of phones and alerts in the user's words: "12 Mar 2026" and
// "3 hours ago". The wire dates are RFC 3339 UTC; '' means unknown.

import { useI18n } from 'vue-i18n';

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
];

export function useAdminDates(): {
    day: (value: string | number) => string;
    dayTime: (value: string | number) => string;
    ago: (value: string) => string;
} {
    const { locale } = useI18n();

    function toTime(value: string | number): number {
        return typeof value === 'number' ? value : Date.parse(value);
    }

    function day(value: string | number): string {
        const time = toTime(value);
        if (!Number.isFinite(time)) return '';
        return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(time);
    }

    function dayTime(value: string | number): string {
        const time = toTime(value);
        if (!Number.isFinite(time)) return '';
        return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(time);
    }

    function ago(value: string): string {
        const time = Date.parse(value);
        if (!Number.isFinite(time)) return '';
        const elapsed = Math.max(0, Date.now() - time);
        const format = new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' });
        for (const [unit, ms] of UNITS) {
            if (elapsed >= ms) return format.format(-Math.floor(elapsed / ms), unit);
        }
        return format.format(0, 'minute');
    }

    return { day, dayTime, ago };
}
