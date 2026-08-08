import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import LightRgbIo from './LightRgbIo.vue';
import ColorPickerDialog from '../dialogs/ColorPickerDialog.vue';
import en from '../../i18n/en.json';
import { toIoItem } from '../../protocol/guards';
import { useHomeStore } from '../../stores/home';
import type { WireIo } from '../../protocol/types';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });

const label = (key: string, name: string): string => i18n.global.t(key, { name });

/** Every frame the component handed to the socket, in order. */
let sent: string[];

function mountRgb(wire: WireIo = {}) {
    const io = toIoItem({
        id: 'output_7',
        name: 'Bandeau LED',
        gui_type: 'light_rgb',
        state: '#ff8800',
        visible: 'true',
        ...wire,
    });
    return mount(LightRgbIo, {
        props: { io },
        global: { plugins: [i18n] },
        attachTo: document.body,
    });
}

/** [on, off, colour] — the row's three controls, in reading order. */
function actions(wrapper: ReturnType<typeof mountRgb>) {
    return wrapper.findAll('.io-row button');
}

beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    document.body.innerHTML = '';
    sent = [];
    useHomeStore().attachTransport((frame) => {
        sent.push(frame);
        return true;
    });
});

afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('LightRgbIo', () => {
    it('fills the swatch with the colour the server reports', async () => {
        const wrapper = mountRgb({ state: '#ff8800' });
        const swatch = wrapper.get('.light-rgb-io__swatch');

        expect(swatch.attributes('style')).toContain('#ff8800');

        await wrapper.setProps({ io: { ...wrapper.props('io'), state: '#00aa55' } });

        expect(wrapper.get('.light-rgb-io__swatch').attributes('style')).toContain('#00aa55');
    });

    it('reads the off states the old controller recognised', async () => {
        // parseLightRgb: '0' becomes '#000', and both '0' and '#000000' are off.
        const wrapper = mountRgb({ state: '0' });

        expect(wrapper.get('.state-icon').classes()).not.toContain('state-icon--on');
        expect(wrapper.get('.state-icon').attributes('aria-label')).toBe(en.io.off);
        expect(wrapper.get('.light-rgb-io__swatch').attributes('style')).toContain('#000');

        await wrapper.setProps({ io: { ...wrapper.props('io'), state: '#000000' } });
        expect(wrapper.get('.state-icon').classes()).not.toContain('state-icon--on');

        await wrapper.setProps({ io: { ...wrapper.props('io'), state: '#ff8800' } });
        expect(wrapper.get('.state-icon').classes()).toContain('state-icon--on');
        expect(wrapper.get('.state-icon').attributes('aria-label')).toBe(en.io.on);
    });

    it('sends the two verbs the server expects, and names all three controls', async () => {
        const wrapper = mountRgb();
        const [on, off, color] = actions(wrapper);

        expect(on.attributes('aria-label')).toBe(label('io.turnOn', 'Bandeau LED'));
        expect(off.attributes('aria-label')).toBe(label('io.turnOff', 'Bandeau LED'));
        expect(color.attributes('aria-label')).toBe(label('io.setColor', 'Bandeau LED'));

        await on.trigger('click');
        await off.trigger('click');

        expect(sent).toEqual([
            '{"msg":"set_state","data":{"id":"output_7","value":"true"}}',
            '{"msg":"set_state","data":{"id":"output_7","value":"false"}}',
        ]);
    });

    it('sends "set #rrggbb" when the picker is confirmed', async () => {
        const wrapper = mountRgb({ state: '#000000' });
        expect(wrapper.findComponent(ColorPickerDialog).props('open')).toBe(false);

        await actions(wrapper)[2].trigger('click');
        const dialog = wrapper.findComponent(ColorPickerDialog);
        expect(dialog.props('open')).toBe(true);
        // The dialog opens on the colour the row currently shows.
        expect(dialog.props('color')).toBe('#000000');
        expect(dialog.props('name')).toBe('Bandeau LED');

        dialog.vm.$emit('confirm', '#ff8800');
        await wrapper.vm.$nextTick();

        expect(sent).toEqual(['{"msg":"set_state","data":{"id":"output_7","value":"set #ff8800"}}']);
        expect(wrapper.findComponent(ColorPickerDialog).props('open')).toBe(false);
    });

    it('sends nothing when the picker is cancelled', async () => {
        const wrapper = mountRgb();

        await actions(wrapper)[2].trigger('click');
        wrapper.findComponent(ColorPickerDialog).vm.$emit('cancel');
        await wrapper.vm.$nextTick();

        expect(sent).toEqual([]);
        expect(wrapper.findComponent(ColorPickerDialog).props('open')).toBe(false);
    });

    it('never draws the colour the user chose, only the one the server reports', async () => {
        // Not optimistic (docs/ARCHITECTURE.md), like every other row.
        const wrapper = mountRgb({ state: '#000000' });

        await actions(wrapper)[2].trigger('click');
        wrapper.findComponent(ColorPickerDialog).vm.$emit('confirm', '#ff8800');
        await wrapper.vm.$nextTick();

        expect(wrapper.get('.light-rgb-io__swatch').attributes('style')).toContain('#000000');
        expect(wrapper.find('.io-row__pending').exists()).toBe(true);

        useHomeStore().handleEvent({ kind: 'io_changed', id: 'output_7', state: '#ff8800' });
        await wrapper.vm.$nextTick();

        expect(wrapper.find('.io-row__pending').exists()).toBe(false);
    });

    it('keeps its controls whatever rw says — an RGB lamp never consults it', () => {
        // docs/ARCHITECTURE.md "The `rw` flag"; calaos_mobile's IOLightRGB.qml
        // never reads it.
        for (const rw of ['false', 'true', undefined]) {
            const wrapper = mountRgb({ rw });

            expect(wrapper.findAll('button').length, `rw=${rw}`).toBeGreaterThan(0);
            expect(wrapper.find('.io-row__actions').exists()).toBe(true);
            // And the lamp still reports its state — and its colour, on the glyph.
            expect(wrapper.get('.state-icon').classes()).toContain('state-icon--on');
            expect(wrapper.get('.state-icon').attributes('style')).toContain('#ff8800');
        }
    });
});
