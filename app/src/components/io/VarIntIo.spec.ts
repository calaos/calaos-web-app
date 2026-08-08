import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import VarIntIo from './VarIntIo.vue';
import en from '../../i18n/en.json';
import { toIoItem } from '../../protocol/guards';
import { useHomeStore } from '../../stores/home';
import type { WireIo } from '../../protocol/types';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });
const label = (key: string, name: string): string => i18n.global.t(key, { name });

let sent: string[];

function mountVarInt(wire: WireIo = {}) {
    const io = toIoItem({
        id: 'output_11',
        name: 'Compteur',
        gui_type: 'var_int',
        state: '3',
        visible: 'true',
        rw: 'true',
        ...wire,
    });
    return mount(VarIntIo, { props: { io }, global: { plugins: [i18n] } });
}

beforeEach(() => {
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

describe('VarIntIo', () => {
    it('shows the value with its unit, and without one when there is none', () => {
        expect(mountVarInt({ state: '3', unit: 'x' }).get('.io-row__value').text()).toBe('3 x');
        expect(mountVarInt({ state: '3', unit: '' }).get('.io-row__value').text()).toBe('3');
    });

    it('draws the same static counter glyph regardless of io_style', () => {
        // Unlike analog_out, the old template hardcoded icon_int.png — no
        // style lookup for this type (docs/ARCHITECTURE.md), and that icon is
        // the one this row still draws.
        const withStyle = mountVarInt({ io_style: 'humidity' });
        const withoutStyle = mountVarInt({ io_style: '' });
        const src = (w: typeof withStyle) => w.get('.io-row__lead img').attributes('src');

        expect(src(withStyle)).toBe(src(withoutStyle));
    });

    it('sends inc/dec, named for the IO, from the +/- buttons', async () => {
        const wrapper = mountVarInt();
        const [inc, dec] = wrapper.findAll('button');

        expect(inc.attributes('aria-label')).toBe(label('io.increase', 'Compteur'));
        expect(dec.attributes('aria-label')).toBe(label('io.decrease', 'Compteur'));

        await inc.trigger('click');
        await dec.trigger('click');

        expect(sent).toEqual([
            '{"msg":"set_state","data":{"id":"output_11","value":"inc"}}',
            '{"msg":"set_state","data":{"id":"output_11","value":"dec"}}',
        ]);
    });

    it('shows the activity dot until the answer arrives', async () => {
        const wrapper = mountVarInt();

        await wrapper.findAll('button')[0].trigger('click');
        expect(wrapper.find('.io-row__pending').exists()).toBe(true);

        useHomeStore().handleEvent({ kind: 'io_changed', id: 'output_11', state: '4' });
        await wrapper.vm.$nextTick();

        expect(wrapper.find('.io-row__pending').exists()).toBe(false);
    });

    it('offers nothing to press when the server marked it read-only', () => {
        const wrapper = mountVarInt({ rw: 'false', state: '7' });

        expect(wrapper.findAll('button')).toHaveLength(0);
        expect(wrapper.find('.io-row__actions').exists()).toBe(false);
        expect(wrapper.get('.io-row__value').text()).toBe('7');
    });
});
