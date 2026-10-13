// Pure helpers behind the climate widget: what to show for a mode, and how a
// setpoint is snapped and bounded. No Vue imports.

import type { DeviceInfo, DeviceTargetTemp } from './types';

/** Which setpoint control a device offers in its current mode. */
export type SetpointKind = 'none' | 'single' | 'range';

export interface ClimateGating {
    /** Mode is `off`: setpoint, fan and swing are shown but cannot be used. */
    off: boolean;
    setpoint: SetpointKind;
}

/**
 * A device with a range has a single setpoint only if its `target_temp` link
 * exists; one that only exposes low/high is "range-only". Without a range the
 * `target_temp` capability implies the link.
 */
function hasSingleSetpoint(device: DeviceInfo): boolean {
    if (device.capabilities.targetTempRange !== true) return true;
    return device.ios.target_temp !== undefined;
}

/**
 * `mode` is '' when the server does not know it yet: that is not `off`, so the
 * controls stay usable, but nothing is selected.
 */
export function climateGating(device: DeviceInfo): ClimateGating {
    const caps = device.capabilities;
    const mode = device.state.mode ?? '';
    if (!caps.targetTemp || mode === 'fan_only') return { off: mode === 'off', setpoint: 'none' };

    const single = hasSingleSetpoint(device);
    const range = caps.targetTempRange === true;
    if (mode === 'auto' && range) return { off: false, setpoint: 'range' };
    if (single) return { off: mode === 'off', setpoint: 'single' };
    // Range-only device: the range is its only setpoint, in every mode.
    return { off: mode === 'off', setpoint: 'range' };
}

export function decimalsOf(n: number): number {
    return String(n).split('.')[1]?.length ?? 0;
}

// The epsilon keeps 0.1 + 0.2 style noise from tipping floor/ceil a step off.
const down = (n: number): number => Math.floor(n + 1e-9);
const up = (n: number): number => Math.ceil(n - 1e-9);

function onGrid(
    value: number,
    { min, max, step }: DeviceTargetTemp,
    round: (n: number) => number,
): number {
    const steps = round((value - min) / step);
    const places = Math.max(decimalsOf(step), decimalsOf(min));
    return Number(Math.min(max, Math.max(min, min + steps * step)).toFixed(places));
}

/** Rounds to the step grid anchored at `min`, then bounds; no float noise. */
export function snapToStep(value: number, bounds: DeviceTargetTemp): number {
    return onGrid(value, bounds, Math.round);
}

export interface Range {
    low: number;
    high: number;
}

/**
 * Moves one handle of a range, never letting the pair get closer than
 * `minRange` or leave the bounds: the server refuses a too-narrow pair whole,
 * so the widget must not be able to produce one.
 */
export function moveRangeHandle(
    which: keyof Range,
    value: number,
    current: Range,
    bounds: DeviceTargetTemp,
): Range {
    const gap = bounds.minRange ?? 0;
    const v = snapToStep(value, bounds);
    if (which === 'low') {
        const ceiling = onGrid(current.high - gap, bounds, down);
        return { low: Math.min(v, ceiling), high: current.high };
    }
    const floor = onGrid(current.low + gap, bounds, up);
    return { low: current.low, high: Math.max(v, floor) };
}

/** `21` at step 0.5 → `21.0`; the decimals follow the step so the thumb and text agree. */
export function formatSetpoint(value: number, step: number): string {
    return value.toFixed(decimalsOf(step));
}
