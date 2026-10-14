import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ClimateDial from './ClimateDial.vue';
import type { DialPaint } from '../../protocol/climate';

const BOUNDS = { min: 16, max: 30, step: 0.5, unit: '°C', minRange: 2 };
const PAINT: DialPaint = { fill: 'cool', between: 'dim', knob: 'cool' };

function dial(props: Record<string, unknown> = {}, slot?: string) {
    return mount(ClimateDial, {
        props: { bounds: BOUNDS, setpoint: 'single', target: 22, paint: PAINT, ...props },
        slots: slot ? { default: slot } : {},
    });
}

describe('ClimateDial', () => {
    it('draws a track, the stretch to the setpoint, and one knob', () => {
        const w = dial();

        expect(w.findAll('.climate-dial__track')).toHaveLength(1);
        expect(w.get('.climate-dial__fill').attributes('style')).toContain('var(--c-accent)');
        expect(w.findAll('.climate-dial__knob')).toHaveLength(1);
        expect(w.get('.climate-dial__knob').attributes('style')).toContain('var(--c-accent)');
    });

    it('is decorative: hidden from assistive technology', () => {
        expect(dial().get('svg').attributes('aria-hidden')).toBe('true');
    });

    it('puts the knob where the temperature is', () => {
        const at = (target: number) => Number(dial({ target }).get('.climate-dial__knob').attributes('cx'));

        // The arc opens at the bottom: a cold setpoint is left, a warm one right.
        expect(at(16)).toBeLessThan(at(23));
        expect(at(23)).toBeLessThan(at(30));
        expect(at(23)).toBeCloseTo(140, 0);
    });

    it('draws two knobs, warm then cool, and the stretch between them, for a range', () => {
        const w = dial({ setpoint: 'range', low: 19.5, high: 24.5, paint: { fill: 'muted', between: 'heat', knob: 'white' } });

        const knobs = w.findAll('.climate-dial__knob');
        expect(knobs.map((k) => k.attributes('style'))).toEqual([
            expect.stringContaining('var(--c-heat)'),
            expect.stringContaining('var(--c-accent)'),
        ]);
        expect(w.get('.climate-dial__fill').attributes('style')).toContain('var(--c-heat)');
        expect(Number(knobs[0].attributes('cx'))).toBeLessThan(Number(knobs[1].attributes('cx')));
    });

    it('draws no knob and no stretch without a setpoint, or without bounds', () => {
        for (const props of [{ target: undefined }, { setpoint: 'none' }, { bounds: undefined }]) {
            const w = dial(props);
            expect(w.findAll('.climate-dial__knob')).toHaveLength(0);
            expect(w.find('.climate-dial__fill').exists()).toBe(false);
        }
    });

    it('draws no half range: both ends are needed', () => {
        const w = dial({ setpoint: 'range', low: 19.5, high: undefined });

        expect(w.findAll('.climate-dial__knob')).toHaveLength(0);
    });

    it('marks the room temperature with a tick, or a dot in the mini dial', () => {
        expect(dial({ current: 25 }).find('line.climate-dial__mark').exists()).toBe(true);

        const mini = dial({ current: 25, mini: true, size: 28, stroke: 3, knob: 3 });
        expect(mini.find('line.climate-dial__mark').exists()).toBe(false);
        expect(mini.find('circle.climate-dial__mark').exists()).toBe(true);
        expect(mini.classes()).toContain('climate-dial--mini');

        expect(dial().find('.climate-dial__mark').exists()).toBe(false);
    });

    it('centres its slot in the arc', () => {
        const w = dial({}, '<span class="inside">23,4</span>');

        expect(w.get('.climate-dial__inner .inside').text()).toBe('23,4');
        expect(w.get('.climate-dial__inner').attributes('style')).toContain('top: 140px');
        expect(dial().find('.climate-dial__inner').exists()).toBe(false);
    });

    it('is sized by its size prop, cropped under the opening', () => {
        const w = dial({ size: 232 });

        expect(w.attributes('style')).toContain('inline-size: 232px');
        expect(Number(w.get('svg').attributes('height'))).toBeLessThan(232);
    });
});
