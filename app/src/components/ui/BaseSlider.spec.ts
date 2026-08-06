import { describe, expect, it } from 'vitest';
import { mount, type DOMWrapper } from '@vue/test-utils';
import BaseSlider from './BaseSlider.vue';

function mountSlider(modelValue = 50) {
    return mount(BaseSlider, { props: { modelValue, label: 'Brightness for Plafonnier' } });
}

// `wrapper.setValue()` fires BOTH `input` and `change` (it exists to serve
// `v-model.lazy`, per its own source), so it cannot stand in for one tick of
// a real drag — every call would look like a release. A real slider drag
// fires only `input` per tick; `change` fires once, separately, on release.
// This mirrors that: it moves the thumb without ending the interaction.
async function dragTo(input: Omit<DOMWrapper<Element>, 'exists'>, value: number) {
    (input.element as HTMLInputElement).value = String(value);
    await input.trigger('input');
}

describe('BaseSlider', () => {
    it("exposes its label as the range input's accessible name", () => {
        const wrapper = mountSlider();

        expect(wrapper.get('input').attributes('aria-label')).toBe('Brightness for Plafonnier');
    });

    it('defaults to a 0-100 step-1 range, matching every IO that uses it today', () => {
        const input = mountSlider().get('input');

        expect(input.attributes('min')).toBe('0');
        expect(input.attributes('max')).toBe('100');
        expect(input.attributes('step')).toBe('1');
    });

    it('starts at the value it is given', () => {
        expect(mountSlider(35).get('input').element.value).toBe('35');
    });

    it('tracks a drag live but sends nothing while it is still in progress', async () => {
        const wrapper = mountSlider(20);
        const input = wrapper.get('input');

        await input.trigger('pointerdown', { pointerType: 'mouse' });
        await dragTo(input, 45);
        await dragTo(input, 60);

        expect(input.element.value).toBe('60');
        expect(wrapper.emitted('commit')).toBeUndefined();
    });

    it('commits exactly once, with the value it was released on, for a mouse drag', async () => {
        const wrapper = mountSlider(20);
        const input = wrapper.get('input');

        await input.trigger('pointerdown', { pointerType: 'mouse' });
        await dragTo(input, 72);
        await input.trigger('pointerup', { pointerType: 'mouse' });
        // The browser fires `change` right after `mouseup` for this same
        // gesture — it must not be read as a second interaction.
        await input.trigger('change');

        expect(wrapper.emitted('commit')).toEqual([[72]]);
    });

    it('commits exactly once, with the value it was released on, for a touch drag', async () => {
        const wrapper = mountSlider(20);
        const input = wrapper.get('input');

        await input.trigger('pointerdown', { pointerType: 'touch' });
        await dragTo(input, 12);
        await dragTo(input, 8);
        await input.trigger('pointerup', { pointerType: 'touch' });
        await input.trigger('change');

        expect(wrapper.emitted('commit')).toEqual([[8]]);
    });

    it('commits once on a keyboard change, with no pointer event at all', async () => {
        const wrapper = mountSlider(20);
        const input = wrapper.get('input');

        // An arrow key on a focused range input fires `input` then `change`
        // synchronously — no `pointerdown`/`pointerup` involved.
        await dragTo(input, 21);
        await input.trigger('change');

        expect(wrapper.emitted('commit')).toEqual([[21]]);
    });

    it('resyncs the thumb to a fresh server value when nothing is interacting', async () => {
        const wrapper = mountSlider(20);

        await wrapper.setProps({ modelValue: 77 });

        expect(wrapper.get('input').element.value).toBe('77');
    });

    it('does not let an incoming server value yank the thumb mid-drag', async () => {
        const wrapper = mountSlider(20);
        const input = wrapper.get('input');

        await input.trigger('pointerdown', { pointerType: 'mouse' });
        await dragTo(input, 50);
        // An unrelated io_changed for this IO lands while the interaction is
        // still open.
        await wrapper.setProps({ modelValue: 3 });
        expect(input.element.value).toBe('50');

        await input.trigger('pointerup', { pointerType: 'mouse' });

        expect(wrapper.emitted('commit')).toEqual([[50]]);
    });
});
