import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import ScenarioIo from './ScenarioIo.vue';
import en from '../../i18n/en.json';
import { toIoItem } from '../../protocol/guards';
import { useHomeStore } from '../../stores/home';
import type { WireIo } from '../../protocol/types';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });

let sent: string[];

function mountScenario(wire: WireIo = {}) {
    const io = toIoItem({
        id: 'output_18',
        name: 'Tout éteindre',
        gui_type: 'scenario',
        state: 'false',
        visible: 'true',
        rw: 'true',
        ...wire,
    });
    return mount(ScenarioIo, { props: { io }, global: { plugins: [i18n] } });
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

describe('ScenarioIo', () => {
    it('shows the scenario by name and offers exactly one thing to do', () => {
        const wrapper = mountScenario();

        expect(wrapper.get('.io-row__name').text()).toBe('Tout éteindre');
        expect(wrapper.findAll('button')).toHaveLength(1);
        expect(wrapper.get('button').attributes('aria-label')).toBe(
            i18n.global.t('io.run', { name: 'Tout éteindre' }),
        );
    });

    it('says nothing about its state, because a scenario has none to report', () => {
        // The wire state is `false` forever; printing it would be noise.
        const wrapper = mountScenario({ state: 'false' });

        expect(wrapper.find('.io-row__value').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('false');
    });

    it('runs the scenario with the same verb as switching a light on', async () => {
        const wrapper = mountScenario();

        await wrapper.get('button').trigger('click');

        expect(sent).toEqual(['{"msg":"set_state","data":{"id":"output_18","value":"true"}}']);
    });

    it('shows the activity dot while the house is working on it', async () => {
        const wrapper = mountScenario();

        await wrapper.get('button').trigger('click');
        expect(wrapper.find('.io-row__pending').exists()).toBe(true);

        useHomeStore().handleEvent({ kind: 'io_changed', id: 'output_18', state: 'false' });
        await wrapper.vm.$nextTick();

        expect(wrapper.find('.io-row__pending').exists()).toBe(false);
    });

    it('offers nothing to press when the scenario is read-only', () => {
        // The old scenario.html showed its play button whatever `rw` said.
        const wrapper = mountScenario({ rw: 'false' });

        expect(wrapper.findAll('button')).toHaveLength(0);
        expect(wrapper.get('.io-row__name').text()).toBe('Tout éteindre');
    });
});
