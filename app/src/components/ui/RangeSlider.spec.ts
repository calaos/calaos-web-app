import { describe, expect, it } from 'vitest';
import { mount, type DOMWrapper } from '@vue/test-utils';
import RangeSlider from './RangeSlider.vue';

const BOUNDS = { min: 16, max: 30, step: 0.5, unit: '°C', minRange: 2 };

function mountRange(low = 19, high = 24, extra: Record<string, unknown> = {}) {
    return mount(RangeSlider, {
        props: { low, high, bounds: BOUNDS, labelLow: 'Lowest', labelHigh: 'Highest', ...extra },
    });
}

async function dragTo(input: Omit<DOMWrapper<Element>, 'exists'>, value: number) {
    (input.element as HTMLInputElement).value = String(value);
    await input.trigger('input');
}

const handle = (w: ReturnType<typeof mountRange>, label: string) =>
    w.get(`input[aria-label="${label}"]`);

describe('RangeSlider', () => {
    it('is two named range inputs bounded by min, max and step', () => {
        const w = mountRange();

        expect(w.findAll('input[type="range"]')).toHaveLength(2);
        for (const label of ['Lowest', 'Highest']) {
            expect(handle(w, label).attributes()).toMatchObject({ min: '16', max: '30', step: '0.5' });
        }
        expect((handle(w, 'Lowest').element as HTMLInputElement).value).toBe('19');
        expect((handle(w, 'Highest').element as HTMLInputElement).value).toBe('24');
    });

    it('reads out each handle with its unit', () => {
        const w = mountRange();

        expect(handle(w, 'Lowest').attributes('aria-valuetext')).toBe('19.0 °C');
        expect(handle(w, 'Highest').attributes('aria-valuetext')).toBe('24.0 °C');
    });

    it('reports the pair while dragging and sends nothing until the release', async () => {
        const w = mountRange();
        const low = handle(w, 'Lowest');

        await low.trigger('pointerdown');
        await dragTo(low, 20);
        await dragTo(low, 21);

        expect(w.emitted('live')).toEqual([[{ low: 20, high: 24 }], [{ low: 21, high: 24 }]]);
        expect(w.emitted('commit')).toBeUndefined();

        await low.trigger('change');
        expect(w.emitted('commit')).toEqual([[{ low: 21, high: 24 }]]);
        expect(w.emitted('live')!.at(-1)).toEqual([null]);
    });

    it('commits once, on release, for a pointer drag, before ending the live report', async () => {
        const order: string[] = [];
        const w = mountRange(19, 24, {
            onCommit: () => order.push('commit'),
            onLive: () => order.push('live'),
        });
        const low = handle(w, 'Lowest');

        await low.trigger('pointerdown');
        await dragTo(low, 20);
        await dragTo(low, 21);
        await low.trigger('pointerup');
        // The browser fires `change` right after the release of the same gesture.
        await low.trigger('change');

        expect(order.filter((e) => e === 'commit')).toHaveLength(1);
        expect(order.lastIndexOf('commit')).toBeLessThan(order.lastIndexOf('live'));
    });

    it('sends the dragged pair, not the old one, after a pointer drag', async () => {
        const w = mountRange();
        const low = handle(w, 'Lowest');

        await low.trigger('pointerdown');
        await dragTo(low, 21);
        await low.trigger('pointerup');
        await low.trigger('change');

        expect(w.emitted('commit')).toEqual([[{ low: 21, high: 24 }]]);
        expect((low.element as HTMLInputElement).value).toBe('21');
    });

    it('sends nothing for a press that moves nothing, and still commits the next key step', async () => {
        const w = mountRange();
        const high = handle(w, 'Highest');

        await high.trigger('pointerdown');
        await high.trigger('pointerup');
        expect(w.emitted('commit')).toBeUndefined();

        await dragTo(high, 25);
        await high.trigger('change');
        expect(w.emitted('commit')).toEqual([[{ low: 19, high: 25 }]]);
    });

    it('commits a keyboard step as input then change', async () => {
        const w = mountRange();
        const high = handle(w, 'Highest');

        await dragTo(high, 24.5);
        await high.trigger('change');

        expect(w.emitted('commit')).toEqual([[{ low: 19, high: 24.5 }]]);
    });

    it('holds the low handle min_range below the high one and pulls the thumb back', async () => {
        const w = mountRange();
        const low = handle(w, 'Lowest');

        await dragTo(low, 28);

        expect((low.element as HTMLInputElement).value).toBe('22');
        expect(w.emitted('live')).toEqual([[{ low: 22, high: 24 }]]);
    });

    it('holds the high handle min_range above the low one', async () => {
        const w = mountRange();
        const high = handle(w, 'Highest');

        await dragTo(high, 17);

        expect((high.element as HTMLInputElement).value).toBe('21');
    });

    it('resyncs to new props, except mid-drag', async () => {
        const w = mountRange();
        const low = handle(w, 'Lowest');

        await w.setProps({ low: 18 });
        expect((low.element as HTMLInputElement).value).toBe('18');

        await low.trigger('pointerdown');
        await dragTo(low, 20);
        await w.setProps({ low: 17 });
        expect((low.element as HTMLInputElement).value).toBe('20');

        await low.trigger('pointerup');
        await w.setProps({ low: 16.5 });
        expect((low.element as HTMLInputElement).value).toBe('16.5');
    });

    it('puts the low handle on top when both sit in the upper half', async () => {
        const w = mountRange(28, 30);
        expect(handle(w, 'Lowest').classes()).toContain('range-slider__input--top');

        await w.setProps({ low: 17, high: 20 });
        expect(handle(w, 'Lowest').classes()).not.toContain('range-slider__input--top');
    });

    it('disables both handles together', () => {
        const w = mountRange(19, 24, { disabled: true });

        for (const input of w.findAll('input')) {
            expect((input.element as HTMLInputElement).disabled).toBe(true);
        }
    });

    it('takes both new bounds when the pair moves past the handles, then drags from there', async () => {
        const w = mountRange(19.5, 24.5);

        await w.setProps({ low: 25, high: 28 });
        expect((handle(w, 'Lowest').element as HTMLInputElement).value).toBe('25');
        expect((handle(w, 'Highest').element as HTMLInputElement).value).toBe('28');

        const high = handle(w, 'Highest');
        await dragTo(high, 29);
        await high.trigger('change');
        expect(w.emitted('commit')).toEqual([[{ low: 25, high: 29 }]]);
    });

    it('follows the server for the handle that is not held, and re-clamps the held one', async () => {
        const w = mountRange(19, 24);
        const low = handle(w, 'Lowest');

        await low.trigger('pointerdown');
        await dragTo(low, 21);
        await w.setProps({ low: 19, high: 22.5 });
        expect((handle(w, 'Highest').element as HTMLInputElement).value).toBe('22.5');
        expect((low.element as HTMLInputElement).value).toBe('20.5');

        await low.trigger('pointerup');
        await low.trigger('change');
        expect(w.emitted('commit')).toEqual([[{ low: 20.5, high: 22.5 }]]);
    });
});
