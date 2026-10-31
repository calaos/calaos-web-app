import { describe, expect, it } from 'vitest';
import {
    TIMEZONE_PATTERN,
    clockDrift,
    filterZones,
    fromLocalInput,
    timeReadBack,
    toLocalInput,
    timeSetParams,
    toBoxTime,
    toTimeParam,
    toTimeSetResult,
    toTimeZones,
} from './admin-time';

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

describe('reading back a time_set that got no answer', () => {
    const before = { now: '2026-10-25T09:00:00Z', timezone: 'Europe/Paris', ntp: true, synchronized: true, rtc: '' };

    it('says which steps took, and asks for the restart only for a zone that changed', () => {
        const after = { ...before, timezone: 'UTC', ntp: true };
        expect(timeReadBack({ timezone: 'UTC', ntp: false }, before, after, 0)).toEqual({
            changed: ['timezone'],
            unchanged: ['ntp'],
            restartRequired: true,
        });
        expect(timeReadBack({ timezone: 'Europe/Paris' }, before, before, 0).restartRequired).toBe(false);
        expect(timeReadBack({ timezone: 'UTC' }, before, before, 0)).toEqual({ changed: [], unchanged: ['timezone'], restartRequired: false });
    });

    it('counts a time as taken when the clock is where it would have run on to', () => {
        const sent = { time: '2026-01-01T00:00:00Z', ntp: false };
        const took = { ...before, now: '2026-01-01T00:00:40Z', ntp: false };
        expect(timeReadBack(sent, before, took, 35_000).changed).toEqual(['ntp', 'time']);
        const missed = { ...before, now: '2026-10-25T09:00:40Z', ntp: false };
        expect(timeReadBack(sent, before, missed, 35_000)).toMatchObject({ changed: ['ntp'], unchanged: ['time'] });
    });
});

describe('a time typed in the box zone', () => {
    const ms = (value: string, zone: string) => {
        const r = fromLocalInput(value, zone);
        return 'ms' in r ? new Date(r.ms).toISOString() : r.error;
    };

    it('is converted with the box zone, not the browser one', () => {
        expect(ms('2026-07-01T12:00:00', 'Europe/Paris')).toBe('2026-07-01T10:00:00.000Z');
        expect(ms('2026-01-01T12:00:00', 'Europe/Paris')).toBe('2026-01-01T11:00:00.000Z');
        expect(ms('2026-07-01T12:00:00', 'Asia/Tokyo')).toBe('2026-07-01T03:00:00.000Z');
        expect(ms('2026-07-01T12:00:00', 'America/New_York')).toBe('2026-07-01T16:00:00.000Z');
        expect(ms('2026-07-01T12:00', 'UTC')).toBe('2026-07-01T12:00:00.000Z');
    });

    it('follows the daylight saving change', () => {
        expect(ms('2027-03-28T01:59:59', 'Europe/Paris')).toBe('2027-03-28T00:59:59.000Z');
        expect(ms('2027-03-28T03:00:00', 'Europe/Paris')).toBe('2027-03-28T01:00:00.000Z');
        expect(ms('2027-10-31T03:00:00', 'Europe/Paris')).toBe('2027-10-31T02:00:00.000Z');
    });

    it('refuses a time the clocks skip, and takes the first of a repeated one', () => {
        expect(ms('2027-03-28T02:30:00', 'Europe/Paris')).toBe('nonexistent');
        expect(ms('2027-10-31T02:30:00', 'Europe/Paris')).toBe('2027-10-31T00:30:00.000Z');
        expect(ms('2027-03-14T02:30:00', 'America/New_York')).toBe('nonexistent');
    });

    it('refuses what the daemon would refuse', () => {
        expect(ms('', 'UTC')).toBe('invalid');
        expect(ms('2026-02-30T10:00:00', 'UTC')).toBe('invalid');
        expect(ms('2019-12-31T23:59:59', 'UTC')).toBe('range');
        expect(ms('2101-01-01T00:00:00', 'UTC')).toBe('range');
    });

    it('prefills the box wall clock', () => {
        expect(toLocalInput(Date.parse('2026-07-01T10:00:00Z'), 'Europe/Paris')).toBe('2026-07-01T12:00:00');
        expect(toLocalInput(Date.parse('2026-07-01T23:30:00Z'), 'Asia/Tokyo')).toBe('2026-07-02T08:30:00');
    });
});

describe('the time zone filter', () => {
    const zones = ['Europe/Paris', 'America/New_York', 'America/North_Dakota/Center', 'UTC'];

    it('ignores case, spaces and underscores', () => {
        expect(filterZones(zones, 'new york')).toEqual(['America/New_York']);
        expect(filterZones(zones, 'NORTH')).toEqual(['America/North_Dakota/Center']);
        expect(filterZones(zones, 'america')).toHaveLength(2);
    });

    it('keeps everything on an empty query and nothing on no match', () => {
        expect(filterZones(zones, '  ')).toEqual(zones);
        expect(filterZones(zones, 'zzz')).toEqual([]);
    });
});
