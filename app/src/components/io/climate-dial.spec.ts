import { describe, expect, it } from 'vitest';
import { ARC_START, PAINT, angleOf, arcPath, layout, polar } from './climate-dial';

const BOUNDS = { min: 16, max: 30 };

describe('angleOf', () => {
    it('spans 300 degrees, opening at the bottom', () => {
        expect(angleOf(16, BOUNDS)).toBe(-150);
        expect(angleOf(23, BOUNDS)).toBe(0);
        expect(angleOf(30, BOUNDS)).toBe(150);
        expect(ARC_START).toBe(-150);
    });

    it('keeps a temperature outside the bounds on the arc', () => {
        expect(angleOf(5, BOUNDS)).toBe(-150);
        expect(angleOf(99, BOUNDS)).toBe(150);
    });
});

describe('polar', () => {
    it('measures from 12 o clock, clockwise', () => {
        const top = polar(100, 100, 50, 0);
        expect(top.x).toBeCloseTo(100);
        expect(top.y).toBeCloseTo(50);

        const right = polar(100, 100, 50, 90);
        expect(right.x).toBeCloseTo(150);
        expect(right.y).toBeCloseTo(100);
    });
});

describe('layout', () => {
    it('crops the SVG just under the opening and keeps the knob inside', () => {
        const l = layout({ size: 280, stroke: 8, knob: 12 });

        expect(l.cx).toBe(140);
        expect(l.cy).toBe(140);
        // Room for the knob and its ring all around the track.
        expect(l.radius).toBe(140 - 15);
        expect(l.height).toBeLessThan(280);
        expect(l.height).toBeGreaterThan(140 + l.radius * Math.cos(Math.PI / 6));
    });

    it('fits the 28px glyph of a row', () => {
        const l = layout({ size: 28, stroke: 3, knob: 3 });

        expect(l.height).toBeLessThanOrEqual(28);
        expect(l.radius).toBeGreaterThan(0);
    });
});

describe('arcPath', () => {
    it('draws clockwise from the first angle to the second, and takes the large arc past 180', () => {
        expect(arcPath(100, 100, 50, -150, 0)).toMatch(/^M[\d.]+ [\d.]+ A50 50 0 0 1 /);
        expect(arcPath(100, 100, 50, -150, 150)).toMatch(/ A50 50 0 1 1 /);
    });

    it('accepts the angles in either order', () => {
        expect(arcPath(100, 100, 50, 0, -150)).toBe(arcPath(100, 100, 50, -150, 0));
    });

    it('keeps a zero-length arc visible', () => {
        const m = arcPath(100, 100, 50, 10, 10).match(/^M(\S+) (\S+) A50 50 0 0 1 (\S+) (\S+)$/)!;

        expect([m[1], m[2]]).not.toEqual([m[3], m[4]]);
    });
});

describe('PAINT', () => {
    it('only uses tokens of the theme', () => {
        for (const value of Object.values(PAINT)) expect(value).toMatch(/^var\(--c-[a-z-]+\)$/);
    });

    it('has a colour for every role the status and the dial use', () => {
        for (const role of ['heat', 'cool', 'wait', 'offline', 'fan', 'muted', 'dim', 'white']) {
            expect(PAINT[role]).toBeDefined();
        }
    });
});
