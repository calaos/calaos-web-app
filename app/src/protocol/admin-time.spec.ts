import { describe, expect, it } from 'vitest';
import { TIMEZONE_PATTERN, clockDrift, timeSetParams, toBoxTime, toTimeParam, toTimeSetResult, toTimeZones } from './admin-time';

describe('box time codec', () => {
    const raw = { now: '2026-10-25T09:12:03Z', timezone: 'Europe/Paris', ntp: true, synchronized: false, rtc: null };

    it('reads <BoxTime>, a null rtc as empty', () => {
        expect(toBoxTime(raw)).toEqual({ now: '2026-10-25T09:12:03Z', timezone: 'Europe/Paris', ntp: true, synchronized: false, rtc: '' });
        expect(toBoxTime(null)).toBeNull();
    });

    it('reads the time_set answer with restart_required', () => {
        expect(toTimeSetResult({ ...raw, restart_required: true })).toMatchObject({ restartRequired: true, time: { timezone: 'Europe/Paris' } });
        expect(toTimeSetResult(raw)?.restartRequired).toBe(false);
    });

    it('reads the zones, strings only', () => {
        expect(toTimeZones({ timezones: ['UTC', 3, 'Europe/Paris'] })).toEqual(['UTC', 'Europe/Paris']);
        expect(toTimeZones({})).toEqual([]);
    });

    it('keeps ntp a boolean and leaves out what is not changed', () => {
        expect(timeSetParams({ ntp: false })).toEqual({ ntp: false });
        expect(timeSetParams({ timezone: 'UTC', time: '2026-10-25T09:12:03Z' })).toEqual({ timezone: 'UTC', time: '2026-10-25T09:12:03Z' });
    });

    it('formats a time at the second, and measures the drift', () => {
        expect(toTimeParam(Date.parse('2026-10-25T09:12:03.456Z'))).toBe('2026-10-25T09:12:03Z');
        expect(clockDrift(toBoxTime(raw)!, Date.parse('2026-10-25T09:12:00Z'))).toBe(3000);
        expect(TIMEZONE_PATTERN.test('America/Argentina/Buenos_Aires')).toBe(true);
        expect(TIMEZONE_PATTERN.test('../etc/passwd x')).toBe(false);
    });
});
