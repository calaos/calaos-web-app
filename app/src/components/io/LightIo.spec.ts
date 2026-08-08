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

    it('stays operable whatever rw says — a light never consults it', () => {
        // `rw` is the Internal types' edit-mode flag. calaos_server sends it
        // for var_bool/var_int/var_string and for nothing else, so a light's
        // `rw` is false on every real house; gating on it here is what left
        // every lamp in the app unswitchable (docs/ARCHITECTURE.md "The `rw`
        // flag"). calaos_mobile's IOLight.qml never reads it either.
        for (const rw of ['false', 'true', undefined]) {
            const wrapper = mountLight({ rw, state: 'true' });

            expect(wrapper.findAll('button'), `rw=${rw}`).toHaveLength(2);
            expect(wrapper.find('.io-row__actions').exists()).toBe(true);
            // And it still says what the light is doing.
            expect(wrapper.get('.state-icon').classes()).toContain('state-icon--on');
        }
    });
});

describe('LightIo — io_style', () => {
    /**
     * The `src` of the live artwork.
     *
     * `:last-child` because a style may stack a still backdrop behind its
     * moving part (the pump); the last layer is always the device itself.
     */
    function litArtwork(wire: WireIo): string | undefined {
        const wrapper = mountLight({ state: 'true', ...wire });
        return wrapper.get('.state-icon__glyph--on img:last-child').attributes('src');
    }

    it.each([['outlet'], ['pump'], ['heater'], ['boiler']])(
        'draws a light with io_style %s as that device, not as a lamp',
        (ioStyle) => {
            // calaos_server ships heating circuits and pumps as `light`s with
            // a style; the rewrite drew all of them as a bulb, so a running
            // pump looked like someone had left a lamp on.
            expect(litArtwork({ io_style: ioStyle })).not.toBe(litArtwork({}));
        },
    );

    it('gives each style its own artwork, all four distinct', () => {
        const seen = ['outlet', 'pump', 'heater', 'boiler', ''].map((io_style) =>
            litArtwork({ io_style }),
        );

        expect(new Set(seen).size).toBe(seen.length);
    });

    it('reads the style from io_style, the key the server really sends', () => {
        expect(litArtwork({ io_style: 'outlet' })).toBe(litArtwork({ gui_style: 'outlet' }));
        // …and io_style wins when a fixture sends both.
        expect(litArtwork({ io_style: 'pump', gui_style: 'heater' })).toBe(
            litArtwork({ io_style: 'pump' }),
        );
    });

    it('spins only the devices that rotate in calaos_mobile, and only while lit', () => {
        const spinning = (wire: WireIo): boolean =>
            mountLight(wire).get('.state-icon').classes().includes('light-io__state--spinning');

        expect(spinning({ io_style: 'pump', state: 'true' })).toBe(true);
        expect(spinning({ io_style: 'outlet', state: 'true' })).toBe(true);
        expect(spinning({ io_style: 'heater', state: 'true' })).toBe(false);
        expect(spinning({ state: 'true' })).toBe(false);
        // A resting pump must sit still, or an "off" row looks busy.
        expect(spinning({ io_style: 'pump', state: 'false' })).toBe(false);
    });

    it('keeps the same two verbs whatever the device is', () => {
        // The style changes the picture, never the protocol.
        const wrapper = mountLight({ io_style: 'boiler' });

        expect(wrapper.findAll('button')).toHaveLength(2);
        expect(
            wrapper.find(`button[aria-label="${label('io.turnOn', 'Plafonnier')}"]`).exists(),
        ).toBe(true);
    });
});
