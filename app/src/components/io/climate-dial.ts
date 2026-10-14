// Geometry of the 300° dial. Pure numbers and path strings: the component
// only has to place them.

import type { DeviceTargetTemp } from '../../protocol/types';

/** The dial opens at the bottom: it starts 150° left of 12 o'clock and spans 300°. */
const START = -150;
const SPAN = 300;

export interface DialSize {
    size: number;
    stroke: number;
    knob: number;
}

export interface Point {
    x: number;
    y: number;
}

export interface DialLayout {
    cx: number;
    cy: number;
    radius: number;
    /** The SVG is cropped under the opening; the setpoint line sits right below. */
    height: number;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export function polar(cx: number, cy: number, r: number, degrees: number): Point {
    const a = ((degrees - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

export function layout({ size, stroke, knob }: DialSize): DialLayout {
    const pad = Math.max(knob + 2, stroke / 2) + 1;
    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - pad;
    return { cx, cy, radius, height: Math.ceil(cy + radius * Math.cos(Math.PI / 6) + pad) };
}

/** Angle in degrees of a temperature on the arc, bounded to the arc's ends. */
export function angleOf(temp: number, bounds: Pick<DeviceTargetTemp, 'min' | 'max'>): number {
    const width = bounds.max - bounds.min;
    // A device announcing min == max has one possible value: the arc's start.
    if (width <= 0) return START;
    return START + SPAN * clamp01((temp - bounds.min) / width);
}

export function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
    let a1 = from;
    let a2 = to;
    if (a2 < a1) [a1, a2] = [a2, a1];
    // A zero-length arc draws nothing: keep the round cap visible.
    if (a2 - a1 < 0.4) a2 = a1 + 0.4;
    const p = polar(cx, cy, r, a1);
    const q = polar(cx, cy, r, a2);
    const large = a2 - a1 > 180 ? 1 : 0;
    return `M${p.x.toFixed(2)} ${p.y.toFixed(2)} A${r} ${r} 0 ${large} 1 ${q.x.toFixed(2)} ${q.y.toFixed(2)}`;
}

export const TRACK_PATH = (l: DialLayout): string => arcPath(l.cx, l.cy, l.radius, START, START + SPAN);
export const ARC_START = START;

/** Colour role → CSS value; every colour is a token of the theme. */
export const PAINT: Record<string, string> = {
    heat: 'var(--c-heat)',
    cool: 'var(--c-accent)',
    wait: 'var(--c-warn)',
    offline: 'var(--c-danger)',
    fan: 'var(--c-text)',
    white: 'var(--c-text)',
    muted: 'var(--c-text-muted)',
    dim: 'var(--c-border-strong)',
};
