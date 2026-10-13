import { describe, expect, it } from 'vitest';
import { climateGating, formatSetpoint, moveRangeHandle, snapToStep } from './climate';
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
        ['heat', 'single', false],
        ['cool', 'single', false],
        ['dry', 'single', false],
        ['auto', 'range', false],
        ['fan_only', 'none', false],
        ['off', 'single', true],
        ['', 'single', false],
    ] as const)('mode %j on a full device → %s setpoint, off=%s', (mode, setpoint, off) => {
        const state = mode === '' ? {} : { mode };
        expect(climateGating(device({ state }))).toEqual({ off, setpoint });
    });

    it('uses a single setpoint in auto when the device has no range', () => {
        expect(
            climateGating(device({ caps: { target_temp_range: false }, state: { mode: 'auto' } })),
        ).toEqual({ off: false, setpoint: 'single' });
    });

    it('offers no setpoint without a target_temp capability', () => {
        const d = device({ state: { mode: 'heat' } });
        delete d.capabilities.targetTemp;
        expect(climateGating(d)).toEqual({ off: false, setpoint: 'none' });
        d.state.mode = 'off';
        expect(climateGating(d)).toEqual({ off: true, setpoint: 'none' });
    });

    describe('range-only device (no target_temp link, none received)', () => {
        const rangeOnly = (mode: string) => device({ rangeOnly: true, state: { mode } });

        it('has a range in auto, none in heat/cool, a greyed range when off or unknown', () => {
            expect(climateGating(rangeOnly('auto')).setpoint).toBe('range');
            expect(climateGating(rangeOnly('heat')).setpoint).toBe('none');
            expect(climateGating(rangeOnly('cool')).setpoint).toBe('none');
            expect(climateGating(rangeOnly('off'))).toEqual({ off: true, setpoint: 'range' });
            expect(climateGating(rangeOnly(''))).toEqual({ off: false, setpoint: 'range' });
        });

        it('treats a received target_temp as proof the single setpoint exists', () => {
            const d = rangeOnly('heat');
            d.state.targetTemp = 21;
            expect(climateGating(d).setpoint).toBe('single');
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

describe('formatSetpoint', () => {
    it('shows as many decimals as the step has', () => {
        expect(formatSetpoint(21, 0.5)).toBe('21.0');
        expect(formatSetpoint(21, 1)).toBe('21');
        expect(formatSetpoint(21.25, 0.25)).toBe('21.25');
    });
});
