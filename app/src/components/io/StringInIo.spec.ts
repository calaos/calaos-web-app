import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import StringInIo from './StringInIo.vue';
import { toIoItem } from '../../protocol/guards';
import type { WireIo } from '../../protocol/types';

function mountStringIn(wire: WireIo) {
    const io = toIoItem({
        id: 'input_3',
        gui_type: 'string_in',
        visible: 'true',
        rw: 'true',
        ...wire,
    });
    return mount(StringInIo, { props: { io } });
}

describe('StringInIo', () => {
    it('shows the text the server sent', () => {
        const wrapper = mountStringIn({ name: 'Dernier réveil', state: '07:15' });

        expect(wrapper.get('.io-row__name').text()).toBe('Dernier réveil');
        expect(wrapper.get('.io-row__value').text()).toBe('07:15');
    });

    it('falls back to the name when there is no text — and shows it once', () => {
        // `parseStringIn` returns the NAME for an empty state (old
        // VarStringCtrl). The old template had no name column to collide with;
        // this row does, so the fallback is honoured by leaving the value out.
        const wrapper = mountStringIn({ name: 'Message', state: '' });

        expect(wrapper.get('.io-row__name').text()).toBe('Message');
        expect(wrapper.find('.io-row__value').exists()).toBe(false);
        expect(wrapper.text()).toBe('Message');
    });

    it('follows the text as it changes, and back to empty', async () => {
        const wrapper = mountStringIn({ name: 'Message', state: 'Bonne nuit' });
        expect(wrapper.get('.io-row__value').text()).toBe('Bonne nuit');

        await wrapper.setProps({ io: { ...wrapper.props('io'), state: '' } });

        expect(wrapper.find('.io-row__value').exists()).toBe(false);
    });

    it('offers nothing to press: this text is the server’s to write', () => {
        const wrapper = mountStringIn({ name: 'Dernier réveil', state: '07:15' });

        expect(wrapper.findAll('button')).toHaveLength(0);
    });
});
