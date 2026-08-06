import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import IoRowFrame from './IoRowFrame.vue';

describe('IoRowFrame', () => {
    it('shows the name and, by default, nothing else', () => {
        const wrapper = mount(IoRowFrame, { props: { name: 'Plafonnier' } });

        expect(wrapper.get('.io-row__name').text()).toBe('Plafonnier');
        // The value and action wrappers are not empty boxes waiting to be
        // filled: a row with no reading must not carry a reading's gap.
        expect(wrapper.find('.io-row__value').exists()).toBe(false);
        expect(wrapper.find('.io-row__actions').exists()).toBe(false);
        expect(wrapper.find('.io-row__note').exists()).toBe(false);
    });

    it('fills the glyph, value and action slots', () => {
        const wrapper = mount(IoRowFrame, {
            props: { name: 'Température' },
            slots: {
                icon: '<svg class="glyph" />',
                value: '21.5 °C',
                actions: '<button class="act">go</button>',
            },
        });

        expect(wrapper.find('.io-row__lead svg.glyph').exists()).toBe(true);
        expect(wrapper.get('.io-row__value').text()).toBe('21.5 °C');
        expect(wrapper.find('.io-row__actions button.act').exists()).toBe(true);
    });

    it('carries a note in the eyebrow when it is given one', () => {
        const wrapper = mount(IoRowFrame, { props: { name: 'Chaudière', note: 'my_type' } });

        expect(wrapper.get('.io-row__note').text()).toBe('my_type');
    });

    it('shows the activity dot and marks itself busy while a set_state is out', async () => {
        const wrapper = mount(IoRowFrame, { props: { name: 'Plafonnier' } });
        expect(wrapper.find('.io-row__pending').exists()).toBe(false);
        expect(wrapper.attributes('aria-busy')).toBeUndefined();

        await wrapper.setProps({ pending: true });

        expect(wrapper.find('.io-row__pending').exists()).toBe(true);
        expect(wrapper.attributes('aria-busy')).toBe('true');
        // Decoration: `aria-busy` is what assistive tech reads, and a live
        // region per row would have a dozen of them talking at once.
        expect(wrapper.get('.io-row__pending').attributes('aria-hidden')).toBe('true');

        await wrapper.setProps({ pending: false });
        expect(wrapper.find('.io-row__pending').exists()).toBe(false);
    });
});
