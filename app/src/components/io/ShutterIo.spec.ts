import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import ShutterIo from './ShutterIo.vue';
import en from '../../i18n/en.json';
import { toIoItem } from '../../protocol/guards';
import { useHomeStore } from '../../stores/home';
import type { WireIo } from '../../protocol/types';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });
const label = (key: string, name: string): string => i18n.global.t(key, { name });

let sent: string[];

function mountShutter(wire: WireIo = {}) {
    const io = toIoItem({
        id: 'shutter_1',
        name: 'Volet salon',
        gui_type: 'shutter',
        state: 'false',
        visible: 'true',
        rw: 'true',
        ...wire,
    });
    return mount(ShutterIo, { props: { io }, global: { plugins: [i18n] } });
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

describe('ShutterIo', () => {
    it('shows the open glyph only for the exact state "true"', async () => {
        const wrapper = mountShutter({ state: 'true' });
        expect(wrapper.get('.state-icon').classes()).toContain('state-icon--on');

        await wrapper.setProps({ io: { ...wrapper.props('io'), state: 'anything else' } });

        expect(wrapper.get('.state-icon').classes()).not.toContain('state-icon--on');
    });

    it('sends exactly up / stop / down, in that order, under their own names', async () => {
        const wrapper = mountShutter();
        const [up, stop, down] = wrapper.findAll('button');

        expect(up.attributes('aria-label')).toBe(label('io.raise', 'Volet salon'));
        expect(stop.attributes('aria-label')).toBe(label('io.stop', 'Volet salon'));
        expect(down.attributes('aria-label')).toBe(label('io.lower', 'Volet salon'));

        await up.trigger('click');
        await stop.trigger('click');
        await down.trigger('click');

        expect(sent).toEqual([
            '{"msg":"set_state","data":{"id":"shutter_1","value":"up"}}',
            '{"msg":"set_state","data":{"id":"shutter_1","value":"stop"}}',
            '{"msg":"set_state","data":{"id":"shutter_1","value":"down"}}',
        ]);
    });

    it('shows the activity dot until the answer arrives', async () => {
        const wrapper = mountShutter();

        await wrapper.findAll('button')[0].trigger('click');
        expect(wrapper.find('.io-row__pending').exists()).toBe(true);

        useHomeStore().handleEvent({ kind: 'io_changed', id: 'shutter_1', state: 'true' });
        await wrapper.vm.$nextTick();

        expect(wrapper.find('.io-row__pending').exists()).toBe(false);
    });

    it('offers nothing to press when the cover is read-only', () => {
        const wrapper = mountShutter({ rw: 'false', state: 'true' });

        expect(wrapper.findAll('button')).toHaveLength(0);
        expect(wrapper.get('.state-icon').classes()).toContain('state-icon--on');
    });
});
