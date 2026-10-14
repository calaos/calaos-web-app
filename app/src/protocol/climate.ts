// Pure helpers behind the climate widget: what to show for a mode, and how a
// setpoint is snapped and bounded. No Vue imports.

import type { DeviceInfo, DeviceTargetTemp } from './types';

/** Which setpoint control a device offers in its current mode. */
export type SetpointKind = 'none' | 'single' | 'range';

export interface ClimateGating {
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
 * setpoint stays available, but nothing is selected.
 */
export function climateGating(device: DeviceInfo): ClimateGating {
    const caps = device.capabilities;
    const mode = device.state.mode ?? '';
    if (!caps.targetTemp || mode === 'fan_only') return { setpoint: 'none' };

    const single = hasSingleSetpoint(device);
    const range = caps.targetTempRange === true;
    if (mode === 'auto' && range) return { setpoint: 'range' };
    if (single) return { setpoint: 'single' };
    // Range-only device: the range is its only setpoint, in every mode.
    return { setpoint: 'range' };
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

// ---------------------------------------------------------------- status ---

/** What the status line says and which colour it takes; see UI_CLIMATE.md. */
export type StatusId =
    | 'offline'
    | 'fault'
    | 'unknown'
    | 'off'
    | 'lockout'
    | 'heating'
    | 'cooling'
    | 'drying'
    | 'fan'
    | 'idle'
    // The device does not report an action: the status falls back to its mode.
    | 'mode';

export type Tone = 'heat' | 'cool' | 'wait' | 'offline' | 'fan' | 'muted';

export interface ClimateStatus {
    id: StatusId;
    tone: Tone;
    /** A heating, cooling, drying or fan action is running right now. */
    acting: boolean;
    /** Raw `fault` string, only when `id` is `fault`. */
    fault?: string;
    /** Seconds before the output may start, only when `id` is `lockout`. */
    seconds?: number;
}

const ACTION_STATUS: Record<string, { id: StatusId; tone: Tone }> = {
    heating: { id: 'heating', tone: 'heat' },
    cooling: { id: 'cooling', tone: 'cool' },
    drying: { id: 'drying', tone: 'cool' },
    fan: { id: 'fan', tone: 'fan' },
};

/**
 * Precedence: a device that cannot be reached or is held by a safety rule
 * says so before anything else, because every other field is stale or moot;
 * then the mode (nothing runs in `off`, nothing is known in `''`); then the
 * lock-out, which explains an idle output the user wants running.
 *
 * `lockoutSeconds` is the locally counted-down value; when it is 0 the
 * lock-out is over even if the server has not republished yet.
 */
export function climateStatus(device: DeviceInfo, lockoutSeconds?: number): ClimateStatus {
    const s = device.state;
    const mode = s.mode ?? '';
    if (s.connected === false) return { id: 'offline', tone: 'offline', acting: false };
    if (s.fault !== undefined) return { id: 'fault', tone: 'offline', acting: false, fault: s.fault };
    if (mode === '') return { id: 'unknown', tone: 'muted', acting: false };
    if (mode === 'off') return { id: 'off', tone: 'muted', acting: false };

    const remaining = lockoutSeconds ?? s.lockout?.remaining ?? 0;
    if (s.lockout && remaining > 0) {
        return { id: 'lockout', tone: 'wait', acting: false, seconds: Math.ceil(remaining) };
    }
    if (!device.capabilities.reportsAction || s.action === undefined) {
        return { id: 'mode', tone: 'muted', acting: false };
    }
    const running = ACTION_STATUS[s.action];
    if (running) return { ...running, acting: true };
    return { id: 'idle', tone: 'muted', acting: false };
}

/** `140` → `{ minutes: 2, seconds: 20 }`; the view decides how to word it. */
export function splitDuration(totalSeconds: number): { minutes: number; seconds: number } {
    const total = Math.max(0, Math.floor(totalSeconds));
    return { minutes: Math.floor(total / 60), seconds: total % 60 };
}

/** `21.5` → `21,5` in French, `21` for a whole number; the step caps the decimals. */
export function formatTemp(value: number, step: number, locale: string): string {
    const digits = Math.max(1, decimalsOf(step));
    return value.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** −/+ are refused while the device is unreachable or has no mode to set a target for. */
export function canAdjust(status: ClimateStatus): boolean {
    return status.id !== 'offline' && status.id !== 'unknown';
}

/** In `auto`, low and high are as close as `min_range` allows: the inner buttons are refused. */
export function atRangeStop(low: number | undefined, high: number | undefined, minRange?: number): boolean {
    if (minRange === undefined || minRange <= 0 || low === undefined || high === undefined) return false;
    return high - low <= minRange + 1e-6;
}

// ------------------------------------------------------------------ paint ---

/** Colour roles of the dial and of the status text; the view maps them to tokens. */
export type Paint = Tone | 'dim' | 'white';

export interface DialPaint {
    /** The arc from the start up to the setpoint. */
    fill: Paint;
    /** The arc between the two handles in `auto`. */
    between: Paint;
    knob: Paint;
    /** The low and high handles in `auto`. */
    ends: [Paint, Paint];
}

const MODE_PAINT: Record<string, Paint> = { heat: 'heat', cool: 'cool', dry: 'cool' };

/**
 * Colour follows what the device is doing; with nothing running it is
 * neutral, and an unreachable or faulty device is dimmed.
 */
export function dialPaint(status: ClimateStatus, mode: string): DialPaint {
    if (status.id === 'offline' || status.id === 'fault') {
        return { fill: 'dim', between: 'dim', knob: 'muted', ends: ['muted', 'muted'] };
    }
    // Warm below, cool above, whatever the device is doing.
    const ends: [Paint, Paint] = ['heat', 'cool'];
    const between: Paint = status.acting ? status.tone : 'dim';
    if (status.acting || status.id === 'lockout') return { fill: status.tone, between, knob: status.tone, ends };
    if (status.id === 'mode') {
        const tone = MODE_PAINT[mode] ?? 'muted';
        return { fill: tone, between, knob: tone === 'muted' ? 'white' : tone, ends };
    }
    return { fill: 'muted', between, knob: 'white', ends };
}
