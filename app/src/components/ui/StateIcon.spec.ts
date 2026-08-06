import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { h } from 'vue';
import StateIcon from './StateIcon.vue';
import type { VNode } from 'vue';

// Functional stand-ins for the MDI components callers pass in. Plain `h`
// rather than string templates: those need the runtime compiler, which the
// app's build deliberately does not ship.
const IconOff = (): VNode => h('svg', { class: 'stub-off' });
const IconOn = (): VNode => h('svg', { class: 'stub-on' });

function mountIcon(props: { on: boolean; label?: string }) {
    return mount(StateIcon, { props: { iconOff: IconOff, iconOn: IconOn, ...props } });
}

describe('StateIcon', () => {
    it('stacks both glyphs so the crossfade has something to fade between', () => {
        const wrapper = mountIcon({ on: false });

        // Both layers are always in the DOM — a v-if would swap them and there
        // would be no half second of one becoming the other.
        expect(wrapper.find('svg.stub-off').exists()).toBe(true);
        expect(wrapper.find('svg.stub-on').exists()).toBe(true);
        expect(wrapper.findAll('.state-icon__glyph')).toHaveLength(2);
    });

    it('flips the state class when the IO changes, and back again', async () => {
        const wrapper = mountIcon({ on: false });
        expect(wrapper.classes()).not.toContain('state-icon--on');

        await wrapper.setProps({ on: true });
        expect(wrapper.classes()).toContain('state-icon--on');

        await wrapper.setProps({ on: false });
        expect(wrapper.classes()).not.toContain('state-icon--on');
    });

    it('announces the state it is showing when it is given a name', () => {
        const wrapper = mountIcon({ on: true, label: 'On' });

        expect(wrapper.attributes('role')).toBe('img');
        expect(wrapper.attributes('aria-label')).toBe('On');
        expect(wrapper.attributes('aria-hidden')).toBeUndefined();
    });

    it('is decoration when the row says the state in text instead', () => {
        // The old app's version of this was a disabled checkbox, which every
        // screen reader found and announced as an unlabelled form control.
        const wrapper = mountIcon({ on: true });

        expect(wrapper.attributes('aria-hidden')).toBe('true');
        expect(wrapper.attributes('role')).toBeUndefined();
        expect(wrapper.attributes('aria-label')).toBeUndefined();
    });
});
