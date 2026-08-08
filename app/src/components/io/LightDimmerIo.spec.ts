import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type DOMWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import LightDimmerIo from './LightDimmerIo.vue';
import en from '../../i18n/en.json';
import { toIoItem } from '../../protocol/guards';
import { useHomeStore } from '../../stores/home';
import type { WireIo } from '../../protocol/types';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });

/** The copy a control announces, straight from the catalogue. */
const label = (key: string, name: string): string => i18n.global.t(key, { name });

// `wrapper.setValue()` fires BOTH `input` and `change` (see BaseSlider.spec.ts),
// so it cannot stand in for one tick of a drag — it would look like a
// release. This fires only `input`, the way a real drag tick does.
async function dragTo(input: Omit<DOMWrapper<Element>, 'exists'>, value: number) {
    (input.element as HTMLInputElement).value = String(value);
    await input.trigger('input');
}

/** Every frame the component handed to the socket, in order. */
let sent: string[];

function mountDimmer(wire: WireIo = {}) {
    const io = toIoItem({
        id: 'output_5',
        name: 'Plafonnier',
        gui_type: 'light_dimmer',
        state: 'set 40',
        visible: 'true',
        ...wire,
    });
    return mount(LightDimmerIo, { props: { io }, global: { plugins: [i18n] } });
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

describe('LightDimmerIo', () => {
    it('reads the percent live from the state, the same way the old dimmer did', () => {
        expect(mountDimmer({ state: 'set 50' }).get('.light-dimmer-io__reading').text()).toBe(
            '50%',
        );
        expect(mountDimmer({ state: '42' }).get('.light-dimmer-io__reading').text()).toBe('42%');
        expect(mountDimmer({ state: 'true' }).get('.light-dimmer-io__reading').text()).toBe(
            '100%',
        );
        expect(mountDimmer({ state: 'false' }).get('.light-dimmer-io__reading').text()).toBe(
            '0%',
        );
    });

    it('lights the glyph exactly when the parsed percent is above zero', async () => {
        const wrapper = mountDimmer({ state: 'set 0' });
        expect(wrapper.get('.state-icon').classes()).not.toContain('state-icon--on');

        await wrapper.setProps({ io: { ...wrapper.props('io'), state: 'set 1' } });
        expect(wrapper.get('.state-icon').classes()).toContain('state-icon--on');
    });

    it('sends the two boundary verbs, and names both buttons', async () => {
        const wrapper = mountDimmer();
        const [on, off] = wrapper.findAll('button');

        expect(on.attributes('aria-label')).toBe(label('io.turnOn', 'Plafonnier'));
        expect(off.attributes('aria-label')).toBe(label('io.turnOff', 'Plafonnier'));

        await on.trigger('click');
        await off.trigger('click');

        expect(sent).toEqual([
            '{"msg":"set_state","data":{"id":"output_5","value":"true"}}',
            '{"msg":"set_state","data":{"id":"output_5","value":"false"}}',
        ]);
    });

    it('names the slider for assistive tech', () => {
        const wrapper = mountDimmer();

        expect(wrapper.get('input[type="range"]').attributes('aria-label')).toBe(
            label('io.brightness', 'Plafonnier'),
        );
    });

    it('sends exactly one set_state, on release, when the slider is dragged', async () => {
        const wrapper = mountDimmer({ state: 'set 40' });
        const slider = wrapper.get('input[type="range"]');

        await slider.trigger('pointerdown', { pointerType: 'mouse' });
        await dragTo(slider, 55);
        await dragTo(slider, 73);
        expect(sent).toEqual([]);

        await slider.trigger('pointerup', { pointerType: 'mouse' });
        // The native `change` that follows the same release must not send a
        // second frame (see BaseSlider.spec.ts).
        await slider.trigger('change');

        expect(sent).toEqual(['{"msg":"set_state","data":{"id":"output_5","value":"set 73"}}']);
    });

    it('shows the activity dot until the answer arrives', async () => {
        const wrapper = mountDimmer();

        await wrapper.findAll('button')[0].trigger('click');
        expect(wrapper.find('.io-row__pending').exists()).toBe(true);

        useHomeStore().handleEvent({ kind: 'io_changed', id: 'output_5', state: 'true' });
        await wrapper.vm.$nextTick();

        expect(wrapper.find('.io-row__pending').exists()).toBe(false);
    });

    it('keeps its buttons and its slider whatever rw says', () => {
        // A dimmer is an output: it never consults `rw` (docs/ARCHITECTURE.md
        // "The `rw` flag"), and calaos_mobile's IOLightDimmer.qml does not
        // either. Gating it here left the slider off every real dimmer.
        for (const rw of ['false', 'true', undefined]) {
            const wrapper = mountDimmer({ rw, state: 'set 65' });

            expect(wrapper.findAll('button'), `rw=${rw}`).toHaveLength(2);
            expect(wrapper.find('input[type="range"]').exists()).toBe(true);
            expect(wrapper.find('.io-row__actions').exists()).toBe(true);
            expect(wrapper.get('.light-dimmer-io__reading').text()).toBe('65%');
        }
    });
});
