import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import LightIo from './LightIo.vue';
import en from '../../i18n/en.json';
import { toIoItem } from '../../protocol/guards';
import { useHomeStore } from '../../stores/home';
import type { WireIo } from '../../protocol/types';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });

/** The copy a control announces, straight from the catalogue. */
const label = (key: string, name: string): string => i18n.global.t(key, { name });

/** Every frame the component handed to the socket, in order. */
let sent: string[];

function mountLight(wire: WireIo = {}) {
    const io = toIoItem({
        id: 'output_1',
        name: 'Plafonnier',
        gui_type: 'light',
        state: 'false',
        visible: 'true',
        rw: 'true',
        ...wire,
    });
    return mount(LightIo, { props: { io }, global: { plugins: [i18n] } });
}

beforeEach(() => {
    // The store arms a 5 s pending timeout on every set_state.
    vi.useFakeTimers();
    setActivePinia(createPinia());
    sent = [];
    useHomeStore().attachTransport((frame) => {
        sent.push(frame);
        return true;
    });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('LightIo', () => {
    it('lights the glyph only for the exact state "true"', async () => {
        const wrapper = mountLight({ state: 'true' });
        expect(wrapper.get('.state-icon').classes()).toContain('state-icon--on');
        expect(wrapper.get('.state-icon').attributes('aria-label')).toBe(en.io.on);

        await wrapper.setProps({ io: { ...wrapper.props('io'), state: 'false' } });

        expect(wrapper.get('.state-icon').classes()).not.toContain('state-icon--on');
        expect(wrapper.get('.state-icon').attributes('aria-label')).toBe(en.io.off);
    });

    it('sends the two verbs the server expects, and names both buttons', async () => {
        const wrapper = mountLight();
        const [on, off] = wrapper.findAll('button');

        expect(on.attributes('aria-label')).toBe(label('io.turnOn', 'Plafonnier'));
        expect(off.attributes('aria-label')).toBe(label('io.turnOff', 'Plafonnier'));

        await on.trigger('click');
        await off.trigger('click');

        expect(sent).toEqual([
            '{"msg":"set_state","data":{"id":"output_1","value":"true"}}',
            '{"msg":"set_state","data":{"id":"output_1","value":"false"}}',
        ]);
    });

    it('never draws the state the user asked for, only the one the server reports', async () => {
        // NOT optimistic (docs/ARCHITECTURE.md): a light that lights up on tap
        // and goes dark a second later is worse than one that takes a second.
        const wrapper = mountLight({ state: 'false' });

        await wrapper.findAll('button')[0].trigger('click');

        expect(wrapper.get('.state-icon').classes()).not.toContain('state-icon--on');
    });

    it('shows the activity dot until the answer arrives', async () => {
        const wrapper = mountLight();
        expect(wrapper.find('.io-row__pending').exists()).toBe(false);

        await wrapper.findAll('button')[0].trigger('click');
        expect(wrapper.find('.io-row__pending').exists()).toBe(true);

        useHomeStore().handleEvent({ kind: 'io_changed', id: 'output_1', state: 'true' });
        await wrapper.vm.$nextTick();

        expect(wrapper.find('.io-row__pending').exists()).toBe(false);
    });

    it('offers nothing to press when the server marked the light read-only', () => {
        // The old light.html never looked at `rw`, though var_bool.html beside
        // it did. Uniform now.
        const wrapper = mountLight({ rw: 'false', state: 'true' });

        expect(wrapper.findAll('button')).toHaveLength(0);
        expect(wrapper.find('.io-row__actions').exists()).toBe(false);
        // It still says what the light is doing.
        expect(wrapper.get('.state-icon').classes()).toContain('state-icon--on');
    });
});
