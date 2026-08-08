import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import ShutterSmartIo from './ShutterSmartIo.vue';
import en from '../../i18n/en.json';
import { toIoItem } from '../../protocol/guards';
import { useHomeStore } from '../../stores/home';
import type { WireIo } from '../../protocol/types';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });
const label = (key: string, name: string): string => i18n.global.t(key, { name });

let sent: string[];

function mountShutterSmart(wire: WireIo = {}) {
    const io = toIoItem({
        id: 'shutter_2',
        name: 'Volet cuisine',
        gui_type: 'shutter_smart',
        state: 'stop 50',
        visible: 'true',
        ...wire,
    });
    return mount(ShutterSmartIo, { props: { io }, global: { plugins: [i18n] } });
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

describe('ShutterSmartIo', () => {
    // The deliberate fix in docs/ARCHITECTURE.md: a NUMERIC percent compare,
    // NaN -> 0, rather than the old code's unused parseInt + string compare.
    it.each([
        { state: 'stop 30', percent: 30, open: true },
        { state: 'up 100', percent: 100, open: false },
        { state: 'down', percent: 0, open: true },
    ])('parses "$state" as $percent% (open: $open)', ({ state, percent, open }) => {
        const wrapper = mountShutterSmart({ state });

        expect(wrapper.get('.shutter-smart-io__percent').text()).toBe(`${percent}%`);
        expect(wrapper.get('.state-icon').classes().includes('state-icon--on')).toBe(open);
    });

    it('sends exactly up / stop / down, in that order, under their own names', async () => {
        const wrapper = mountShutterSmart();
        const [up, stop, down] = wrapper.findAll('button');

        expect(up.attributes('aria-label')).toBe(label('io.raise', 'Volet cuisine'));
        expect(stop.attributes('aria-label')).toBe(label('io.stop', 'Volet cuisine'));
        expect(down.attributes('aria-label')).toBe(label('io.lower', 'Volet cuisine'));

        await up.trigger('click');
        await stop.trigger('click');
        await down.trigger('click');

        expect(sent).toEqual([
            '{"msg":"set_state","data":{"id":"shutter_2","value":"up"}}',
            '{"msg":"set_state","data":{"id":"shutter_2","value":"stop"}}',
            '{"msg":"set_state","data":{"id":"shutter_2","value":"down"}}',
        ]);
    });

    it('shows the activity dot until the answer arrives', async () => {
        const wrapper = mountShutterSmart();

        await wrapper.findAll('button')[0].trigger('click');
        expect(wrapper.find('.io-row__pending').exists()).toBe(true);

        useHomeStore().handleEvent({ kind: 'io_changed', id: 'shutter_2', state: 'up 100' });
        await wrapper.vm.$nextTick();

        expect(wrapper.find('.io-row__pending').exists()).toBe(false);
    });

    it('keeps its controls whatever rw says', () => {
        // docs/ARCHITECTURE.md "The `rw` flag"; calaos_mobile's
        // IOShutterSmart.qml never reads it.
        for (const rw of ['false', 'true', undefined]) {
            const wrapper = mountShutterSmart({ rw, state: 'up 100' });

            expect(wrapper.findAll('button').length, `rw=${rw}`).toBeGreaterThan(0);
            expect(wrapper.get('.shutter-smart-io__percent').text()).toBe('100%');
        }
    });
});
