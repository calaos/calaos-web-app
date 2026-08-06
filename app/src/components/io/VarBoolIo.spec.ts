import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import VarBoolIo from './VarBoolIo.vue';
import en from '../../i18n/en.json';
import { toIoItem } from '../../protocol/guards';
import { useHomeStore } from '../../stores/home';
import type { WireIo } from '../../protocol/types';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });
const label = (key: string, name: string): string => i18n.global.t(key, { name });

let sent: string[];

function mountVarBool(wire: WireIo = {}) {
    const io = toIoItem({
        id: 'output_9',
        name: 'Mode vacances',
        gui_type: 'var_bool',
        state: 'false',
        visible: 'true',
        rw: 'true',
        ...wire,
    });
    return mount(VarBoolIo, { props: { io }, global: { plugins: [i18n] } });
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

describe('VarBoolIo', () => {
    it('checks the glyph only for the exact state "true"', async () => {
        const wrapper = mountVarBool({ state: 'true' });
        expect(wrapper.get('.state-icon').classes()).toContain('state-icon--on');

        await wrapper.setProps({ io: { ...wrapper.props('io'), state: 'anything else' } });

        expect(wrapper.get('.state-icon').classes()).not.toContain('state-icon--on');
    });

    it('sends the same two verbs as a light, under the same two names', async () => {
        const wrapper = mountVarBool();
        const [on, off] = wrapper.findAll('button');

        expect(on.attributes('aria-label')).toBe(label('io.turnOn', 'Mode vacances'));
        expect(off.attributes('aria-label')).toBe(label('io.turnOff', 'Mode vacances'));

        await on.trigger('click');
        await off.trigger('click');

        expect(sent).toEqual([
            '{"msg":"set_state","data":{"id":"output_9","value":"true"}}',
            '{"msg":"set_state","data":{"id":"output_9","value":"false"}}',
        ]);
    });

    it('shows the activity dot until the answer arrives', async () => {
        const wrapper = mountVarBool();

        await wrapper.findAll('button')[0].trigger('click');
        expect(wrapper.find('.io-row__pending').exists()).toBe(true);

        useHomeStore().handleEvent({ kind: 'io_changed', id: 'output_9', state: 'true' });
        await wrapper.vm.$nextTick();

        expect(wrapper.find('.io-row__pending').exists()).toBe(false);
    });

    it('offers nothing to press when the flag is read-only', () => {
        const wrapper = mountVarBool({ rw: 'false', state: 'true' });

        expect(wrapper.findAll('button')).toHaveLength(0);
        expect(wrapper.get('.state-icon').classes()).toContain('state-icon--on');
    });
});
