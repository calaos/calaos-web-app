import { describe, expect, it } from 'vitest';
import {
    atRangeStop,
    canAdjust,
    climateGating,
    climateStatus,
    dialPaint,
    formatTemp,
    moveRangeHandle,
    snapToStep,
    splitDuration,
} from './climate';
import { toDeviceInfo } from './guards';
import type { DeviceInfo } from './types';

const BOUNDS = { min: 16, max: 30, step: 0.5, unit: '°C', minRange: 2 };

function device(over: {
    caps?: Record<string, unknown>;
    state?: Record<string, unknown>;
    /** No `target_temp` link: the device only exposes low/high. */
    rangeOnly?: boolean;
}): DeviceInfo {
    const d = toDeviceInfo({
        family: 'climate',
        impl: 'proxy',
        capabilities: {
            modes: ['off', 'heat', 'cool', 'auto', 'dry', 'fan_only'],
            target_temp: { min: 16, max: 30, step: 0.5, unit: '°C', min_range: 2 },
            target_temp_range: true,
            ...over.caps,
        },
        state: { mode: 'heat', ...over.state },
        ios: over.rangeOnly ? { mode: 'm' } : { mode: 'm', target_temp: 't' },
    });
    if (!d) throw new Error('fixture must decode');
    return d;
}

describe('climateGating', () => {
    it.each([
        ['heat', 'single'],
        ['cool', 'single'],
        ['dry', 'single'],
        ['auto', 'range'],
        ['fan_only', 'none'],
        ['off', 'single'],
        ['', 'single'],
    ] as const)('mode %j on a full device → %s setpoint', (mode, setpoint) => {
        const state = mode === '' ? {} : { mode };
        expect(climateGating(device({ state }))).toEqual({ setpoint });
    });

    it('uses a single setpoint in auto when the device has no range', () => {
        expect(
            climateGating(device({ caps: { target_temp_range: false }, state: { mode: 'auto' } })),
        ).toEqual({ setpoint: 'single' });
    });

    it('offers no setpoint without a target_temp capability', () => {
        const d = device({ state: { mode: 'heat' } });
        delete d.capabilities.targetTemp;
        expect(climateGating(d)).toEqual({ setpoint: 'none' });
    });

    describe('range-only device (range capability, no target_temp link)', () => {
        const rangeOnly = (mode: string) => device({ rangeOnly: true, state: { mode } });

        it.each([
            ['auto', 'range'],
            ['heat', 'range'],
            ['cool', 'range'],
            ['dry', 'range'],
            ['off', 'range'],
            ['', 'range'],
            ['fan_only', 'none'],
        ] as const)('mode %j → %s setpoint', (mode, setpoint) => {
            expect(climateGating(rangeOnly(mode))).toEqual({ setpoint });
        });

        it('stays range-only even if a stray target_temp value was received', () => {
            const d = rangeOnly('heat');
            d.state.targetTemp = 21;
            expect(climateGating(d).setpoint).toBe('range');
        });
    });
});

describe('snapToStep', () => {
    it('rounds to the step grid anchored at min and clamps to the bounds', () => {
        expect(snapToStep(21.3, BOUNDS)).toBe(21.5);
        expect(snapToStep(21.2, BOUNDS)).toBe(21);
        expect(snapToStep(99, BOUNDS)).toBe(30);
        expect(snapToStep(-4, BOUNDS)).toBe(16);
    });

    it('anchors the grid at min, not at zero', () => {
        expect(snapToStep(10.4, { min: 7.25, max: 20, step: 0.5, unit: '' })).toBe(10.25);
    });

    it('does not leak float noise', () => {
        expect(snapToStep(0.3, { min: 0, max: 1, step: 0.1, unit: '' })).toBe(0.3);
    });
});

describe('moveRangeHandle', () => {
    const range = { low: 19, high: 24 };

    it('moves a handle freely inside the gap', () => {
        expect(moveRangeHandle('low', 20, range, BOUNDS)).toEqual({ low: 20, high: 24 });
        expect(moveRangeHandle('high', 26.3, range, BOUNDS)).toEqual({ low: 19, high: 26.5 });
    });

    it('stops the low handle min_range below the high one', () => {
        expect(moveRangeHandle('low', 23.5, range, BOUNDS)).toEqual({ low: 22, high: 24 });
        expect(moveRangeHandle('low', 30, range, BOUNDS)).toEqual({ low: 22, high: 24 });
    });

    it('stops the high handle min_range above the low one', () => {
        expect(moveRangeHandle('high', 19.5, range, BOUNDS)).toEqual({ low: 19, high: 21 });
        expect(moveRangeHandle('high', 16, range, BOUNDS)).toEqual({ low: 19, high: 21 });
    });

    it('keeps the gap on the step grid when min_range is off-grid', () => {
        const odd = { ...BOUNDS, minRange: 1.2 };
        const low = moveRangeHandle('low', 30, range, odd).low;
        const high = moveRangeHandle('high', 16, range, odd).high;
        expect(24 - low).toBeGreaterThanOrEqual(1.2);
        expect(high - 19).toBeGreaterThanOrEqual(1.2);
        expect(low).toBe(22.5);
        expect(high).toBe(20.5);
    });

    it('bounds the handles at min and max', () => {
        expect(moveRangeHandle('low', 3, range, BOUNDS).low).toBe(16);
        expect(moveRangeHandle('high', 99, range, BOUNDS).high).toBe(30);
    });

    it('allows touching handles when there is no min_range', () => {
        const free = { min: 7, max: 35, step: 1, unit: '' };
        expect(moveRangeHandle('low', 30, { low: 10, high: 20 }, free)).toEqual({ low: 20, high: 20 });
    });
});

describe('climateStatus', () => {
    const acting = { caps: { reports_action: true } };

    it('maps each running action to its word and colour', () => {
        for (const [action, id, tone] of [
            ['heating', 'heating', 'heat'],
            ['cooling', 'cooling', 'cool'],
            ['drying', 'drying', 'cool'],
            ['fan', 'fan', 'fan'],
        ] as const) {
            expect(climateStatus(device({ ...acting, state: { action } }))).toEqual({ id, tone, acting: true });
        }
    });

    it('says idle, neutral, for any action that is not running', () => {
        for (const action of ['idle', 'off', 'something_new']) {
            expect(climateStatus(device({ ...acting, state: { action } }))).toEqual({ id: 'idle', tone: 'muted', acting: false });
        }
    });

    it('falls back to the mode when the device reports no action', () => {
        expect(climateStatus(device({ state: { mode: 'cool', action: 'cooling' } })).id).toBe('mode');
        expect(climateStatus(device({ ...acting, state: { mode: 'cool' } })).id).toBe('mode');
    });

    it('reports off and unknown as neutral, whatever the action says', () => {
        expect(climateStatus(device({ ...acting, state: { mode: 'off', action: 'heating' } }))).toMatchObject({ id: 'off', acting: false });
        expect(climateStatus(device({ ...acting, state: { mode: '', action: 'heating' } }))).toMatchObject({ id: 'unknown', acting: false });
        expect(climateStatus(device({ ...acting, state: { mode: undefined } })).id).toBe('unknown');
    });

    it('reports a lock-out in amber with the seconds left, rounded up', () => {
        const d = device({ ...acting, state: { action: 'idle', lockout: { output: 'heat', remaining: 140 } } });

        expect(climateStatus(d)).toEqual({ id: 'lockout', tone: 'wait', acting: false, seconds: 140 });
        expect(climateStatus(d, 12.2)).toMatchObject({ id: 'lockout', seconds: 13 });
    });

    it('ends the lock-out at zero seconds even if the server has not republished', () => {
        const d = device({ ...acting, state: { action: 'idle', lockout: { output: 'heat', remaining: 140 } } });

        expect(climateStatus(d, 0).id).toBe('idle');
    });

    it('reports an unreachable device before a fault, and a fault before the mode', () => {
        const both = { connected: false, fault: 'sensor_stale', mode: 'off' };

        expect(climateStatus(device({ state: both }))).toEqual({ id: 'offline', tone: 'offline', acting: false });
        expect(climateStatus(device({ state: { fault: 'sensor_stale', mode: 'off' } }))).toEqual({
            id: 'fault',
            tone: 'offline',
            acting: false,
            fault: 'sensor_stale',
        });
    });

    it('says a lock-out before an action but after off', () => {
        const lock = { output: 'heat', remaining: 9 };

        expect(climateStatus(device({ ...acting, state: { action: 'heating', lockout: lock } })).id).toBe('lockout');
        expect(climateStatus(device({ ...acting, state: { mode: 'off', lockout: lock } })).id).toBe('off');
    });
});

describe('canAdjust', () => {
    it('refuses −/+ for an unreachable device and an unknown mode only', () => {
        const can = (state: Record<string, unknown>) => canAdjust(climateStatus(device({ state })));

        expect(can({ connected: false })).toBe(false);
        expect(can({ mode: '' })).toBe(false);
        expect(can({ mode: 'off' })).toBe(true);
        expect(can({ fault: 'sensor_stale' })).toBe(true);
        expect(can({ mode: 'heat' })).toBe(true);
    });
});

describe('atRangeStop', () => {
    it('is true when low and high are min_range apart or closer', () => {
        expect(atRangeStop(21, 23, 2)).toBe(true);
        expect(atRangeStop(21, 22.5, 2)).toBe(true);
        expect(atRangeStop(21, 23.5, 2)).toBe(false);
    });

    it('is false without a gap to keep, or without both ends', () => {
        expect(atRangeStop(21, 21, undefined)).toBe(false);
        expect(atRangeStop(21, 21, 0)).toBe(false);
        expect(atRangeStop(undefined, 23, 2)).toBe(false);
        expect(atRangeStop(21, undefined, 2)).toBe(false);
    });

    it('shrugs off float noise at the stop', () => {
        expect(atRangeStop(0.1 + 0.2, 2.3, 2)).toBe(true);
    });
});

describe('dialPaint', () => {
    const paint = (state: Record<string, unknown>, caps: Record<string, unknown> = { reports_action: true }) => {
        const d = device({ caps, state });
        return dialPaint(climateStatus(d), d.state.mode ?? '');
    };

    it('follows the running action', () => {
        expect(paint({ action: 'heating' })).toMatchObject({ fill: 'heat', between: 'heat', knob: 'heat' });
        expect(paint({ mode: 'cool', action: 'cooling' })).toMatchObject({ fill: 'cool', between: 'cool', knob: 'cool' });
    });

    it('is amber while a lock-out holds the output', () => {
        expect(paint({ action: 'idle', lockout: { output: 'heat', remaining: 9 } })).toMatchObject({ fill: 'wait', knob: 'wait' });
    });

    it('is neutral with white knob when nothing runs, and dims the range between the knobs', () => {
        expect(paint({ action: 'idle' })).toMatchObject({ fill: 'muted', between: 'dim', knob: 'white' });
        expect(paint({ mode: 'off' })).toMatchObject({ fill: 'muted', knob: 'white' });
    });

    it('dims everything, the range knobs included, for an unreachable device or a fault', () => {
        const dimmed = { fill: 'dim', between: 'dim', knob: 'muted', ends: ['muted', 'muted'] };

        expect(paint({ connected: false })).toEqual(dimmed);
        expect(paint({ fault: 'sensor_stale' })).toEqual(dimmed);
    });

    it('keeps the range ends warm below and cool above otherwise', () => {
        expect(paint({ action: 'heating' }).ends).toEqual(['heat', 'cool']);
        expect(paint({ mode: 'off' }).ends).toEqual(['heat', 'cool']);
    });

    it('takes the colour of the mode when the device does not say what it does', () => {
        expect(paint({ mode: 'heat' }, {})).toMatchObject({ fill: 'heat', knob: 'heat' });
        expect(paint({ mode: 'dry' }, {})).toMatchObject({ fill: 'cool', knob: 'cool' });
        expect(paint({ mode: 'auto' }, {})).toMatchObject({ fill: 'muted', knob: 'white' });
    });
});

describe('splitDuration', () => {
    it('splits seconds into minutes and seconds, never negative', () => {
        expect(splitDuration(140)).toEqual({ minutes: 2, seconds: 20 });
        expect(splitDuration(59)).toEqual({ minutes: 0, seconds: 59 });
        expect(splitDuration(60.9)).toEqual({ minutes: 1, seconds: 0 });
        expect(splitDuration(-4)).toEqual({ minutes: 0, seconds: 0 });
    });
});

describe('formatTemp', () => {
    it('drops a useless decimal and uses the locale separator', () => {
        expect(formatTemp(22, 0.5, 'en')).toBe('22');
        expect(formatTemp(22.5, 0.5, 'en')).toBe('22.5');
        expect(formatTemp(22.5, 0.5, 'fr')).toBe('22,5');
    });

    it('follows a finer step, and shows at least one decimal of a coarse one', () => {
        expect(formatTemp(21.25, 0.25, 'en')).toBe('21.25');
        expect(formatTemp(21.3, 1, 'en')).toBe('21.3');
    });
});
