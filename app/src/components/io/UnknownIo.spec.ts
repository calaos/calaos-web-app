import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import UnknownIo from './UnknownIo.vue';
import en from '../../i18n/en.json';
import { toIoItem } from '../../protocol/guards';
import type { WireIo } from '../../protocol/types';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });

function mountUnknown(wire: WireIo) {
    const io = toIoItem({ id: 'io_x', visible: 'true', ...wire });
    return mount(UnknownIo, { props: { io }, global: { plugins: [i18n] } });
}

describe('UnknownIo — a gui_type this version has never heard of', () => {
    it('shows the IO like any other row, and names the type the server used', () => {
        // The old default_template.html printed "TEMPLATE TO BE DONE :
        // <type>" into the room, in English, on the wall panel.
        const wrapper = mountUnknown({ name: 'Compteur Linky', gui_type: 'smart_meter' });

        expect(wrapper.get('.io-row__name').text()).toBe('Compteur Linky');
        expect(wrapper.get('.io-row__note').text()).toBe('smart_meter');
        expect(wrapper.text()).not.toContain('TEMPLATE');
    });

    it('shows the raw state, since nothing here knows how to read it', () => {
        const wrapper = mountUnknown({ name: 'Chose', gui_type: 'mystery', state: 'blob 42' });

        expect(wrapper.get('.io-row__value').text()).toBe('blob 42');
    });

    it('says so in words when the server sent no type at all', () => {
        const wrapper = mountUnknown({ name: 'Chose', state: '1' });

        expect(wrapper.get('.io-row__note').text()).toBe(en.io.unknownType);
    });

    it('never guesses a verb for something it does not understand', () => {
        const wrapper = mountUnknown({ name: 'Chaudière', gui_type: 'boiler', state: 'on' });

        expect(wrapper.findAll('button')).toHaveLength(0);
        expect(wrapper.find('.io-row__actions').exists()).toBe(false);
    });
});

describe('UnknownIo — standing in for a control that is not built yet', () => {
    // The dispatch table in IoRow.vue points the T11–T13 gui_types here until
    // their own components land.
    it('shows a known-but-unbuilt type by name and raw state, with no eyebrow', () => {
        const wrapper = mountUnknown({
            name: 'Volet baie vitrée',
            gui_type: 'shutter_smart',
            state: 'up 100',
        });

        expect(wrapper.get('.io-row__name').text()).toBe('Volet baie vitrée');
        expect(wrapper.get('.io-row__value').text()).toBe('up 100');
        // It is a perfectly valid shutter; nothing about it is unknown.
        expect(wrapper.find('.io-row__note').exists()).toBe(false);
    });

    it('leaves out the value column when there is no state to show', () => {
        const wrapper = mountUnknown({ name: 'Message', gui_type: 'var_string', state: '' });

        expect(wrapper.find('.io-row__value').exists()).toBe(false);
    });

    it('prefers the glyph the server asked for over its own fallback', () => {
        const path = (wrapper: ReturnType<typeof mountUnknown>): string | undefined =>
            wrapper.get('.io-row__lead path').attributes('d');

        const styled = mountUnknown({ gui_type: 'var_int', gui_style: 'temp', state: '20' });
        const bare = mountUnknown({ gui_type: 'var_int', state: '20' });

        expect(path(styled)).not.toBe(path(bare));
    });
});
