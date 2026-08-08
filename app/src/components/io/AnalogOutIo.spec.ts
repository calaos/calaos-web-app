import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import AnalogOutIo from './AnalogOutIo.vue';
import en from '../../i18n/en.json';
import { toIoItem } from '../../protocol/guards';
import { useHomeStore } from '../../stores/home';
import type { WireIo } from '../../protocol/types';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });
const label = (key: string, name: string): string => i18n.global.t(key, { name });

let sent: string[];

function mountAnalogOut(wire: WireIo = {}) {
    const io = toIoItem({
        id: 'output_7',
        name: 'Volet moteur',
        gui_type: 'analog_out',
        state: '42',
        visible: 'true',
        ...wire,
    });
    return mount(AnalogOutIo, { props: { io }, global: { plugins: [i18n] } });
}

/**
 * The artwork the row drew. Calaos's own picture files now, not MDI paths, so
 * the `src` is what tells one from another.
 */
function glyphPath(wrapper: ReturnType<typeof mountAnalogOut>): string {
    return wrapper.get('.io-row__lead img').attributes('src') ?? '';
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

describe('AnalogOutIo', () => {
    it('shows the value with its unit, and without one when there is none', () => {
        expect(mountAnalogOut({ state: '412', unit: 'lux' }).get('.io-row__value').text()).toBe(
            '412 lux',
        );
        expect(mountAnalogOut({ state: '412', unit: '' }).get('.io-row__value').text()).toBe(
            '412',
        );
    });

    it('draws the glyph the server asked for, from the same table analog_in uses', () => {
        const humidity = mountAnalogOut({ io_style: 'humidity' });
        const fallback = mountAnalogOut({ io_style: '' });

        expect(glyphPath(humidity)).not.toBe(glyphPath(fallback));
    });

    it('sends inc/dec, named for the IO, from the +/- buttons', async () => {
        const wrapper = mountAnalogOut();
        const [inc, dec] = wrapper.findAll('button');

        expect(inc.attributes('aria-label')).toBe(label('io.increase', 'Volet moteur'));
        expect(dec.attributes('aria-label')).toBe(label('io.decrease', 'Volet moteur'));

        await inc.trigger('click');
        await dec.trigger('click');

        expect(sent).toEqual([
            '{"msg":"set_state","data":{"id":"output_7","value":"inc"}}',
            '{"msg":"set_state","data":{"id":"output_7","value":"dec"}}',
        ]);
    });

    it('shows the activity dot until the answer arrives', async () => {
        const wrapper = mountAnalogOut();

        await wrapper.findAll('button')[0].trigger('click');
        expect(wrapper.find('.io-row__pending').exists()).toBe(true);

        useHomeStore().handleEvent({ kind: 'io_changed', id: 'output_7', state: '43' });
        await wrapper.vm.$nextTick();

        expect(wrapper.find('.io-row__pending').exists()).toBe(false);
    });

    it('keeps its +/- whatever rw says — an analog_out is always writable', () => {
        // The old analog_out.html never looked at `rw`, and calaos_mobile goes
        // further: RoomModel force-sets `rw = true` for this type so it can
        // share var_int's QML ("force rw for analog_out to let us use the same
        // qml than var_int"). See docs/ARCHITECTURE.md "The `rw` flag".
        for (const rw of ['false', 'true', undefined]) {
            const wrapper = mountAnalogOut({ rw, state: '10' });

            expect(wrapper.findAll('button'), `rw=${rw}`).toHaveLength(2);
            expect(wrapper.find('.io-row__actions').exists()).toBe(true);
            expect(wrapper.get('.io-row__value').text()).toBe('10');
        }
    });
});
