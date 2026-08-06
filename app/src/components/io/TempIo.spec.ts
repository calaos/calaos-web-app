import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import TempIo from './TempIo.vue';
import { toIoItem } from '../../protocol/guards';
import type { WireIo } from '../../protocol/types';

function mountTemp(wire: WireIo) {
    const io = toIoItem({ id: 'input_1', gui_type: 'temp', visible: 'true', rw: 'true', ...wire });
    return mount(TempIo, { props: { io } });
}

describe('TempIo', () => {
    it('shows the reading with the unit the server sent', () => {
        const wrapper = mountTemp({ name: 'Température salon', state: '21.5', unit: '°C' });

        expect(wrapper.get('.io-row__name').text()).toBe('Température salon');
        expect(wrapper.get('.io-row__value').text()).toBe('21.5 °C');
    });

    it('falls back to °C only when the server sent no unit', () => {
        // The old template hardcoded °C and reported a Fahrenheit probe in
        // Celsius (docs/ARCHITECTURE.md, deliberate fix).
        expect(mountTemp({ state: '19' }).get('.io-row__value').text()).toBe('19 °C');
        expect(mountTemp({ state: '66.2', unit: '°F' }).get('.io-row__value').text()).toBe(
            '66.2 °F',
        );
    });

    it('follows the store when a new reading arrives', async () => {
        const wrapper = mountTemp({ name: 'Température', state: '21.5', unit: '°C' });

        const io = { ...wrapper.props('io'), state: '23.7' };
        await wrapper.setProps({ io });

        expect(wrapper.get('.io-row__value').text()).toBe('23.7 °C');
    });

    it('offers nothing to press, whatever rw says', () => {
        // A temperature has no verb. `rw: true` on an input is common in the
        // wild and must not conjure controls that would do nothing.
        const wrapper = mountTemp({ state: '21.5', unit: '°C' });

        expect(wrapper.find('.io-row__actions').exists()).toBe(false);
        expect(wrapper.findAll('button')).toHaveLength(0);
    });
});
