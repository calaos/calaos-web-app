import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import VarStringIo from './VarStringIo.vue';
import TextInputDialog from '../dialogs/TextInputDialog.vue';
import en from '../../i18n/en.json';
import { toIoItem } from '../../protocol/guards';
import { useHomeStore } from '../../stores/home';
import type { WireIo } from '../../protocol/types';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });

const label = (key: string, name: string): string => i18n.global.t(key, { name });

let sent: string[];

function mountString(wire: WireIo = {}) {
    const io = toIoItem({
        id: 'output_9',
        name: 'Message écran',
        gui_type: 'var_string',
        state: 'Bonjour',
        visible: 'true',
        rw: 'true',
        ...wire,
    });
    return mount(VarStringIo, {
        props: { io },
        global: { plugins: [i18n] },
        attachTo: document.body,
    });
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

describe('VarStringIo', () => {
    it('draws both wire types it serves', () => {
        // One component, two gui_types — var_string and string_out shared a
        // controller in the old app and share a row here.
        for (const guiType of ['var_string', 'string_out']) {
            const wrapper = mountString({ gui_type: guiType, state: 'Bonjour' });

            expect(wrapper.get('.io-row__name').text()).toBe('Message écran');
            expect(wrapper.get('.var-string-io__text').text()).toBe('Bonjour');
        }
    });

    it('shows the name once, and no value at all, when the state is empty', async () => {
        // The parser falls back to the NAME for an empty state (old
        // VarStringCtrl). This row has a name column, so honouring that
        // fallback literally would print the name twice.
        const wrapper = mountString({ state: '' });

        expect(wrapper.get('.io-row__name').text()).toBe('Message écran');
        expect(wrapper.find('.io-row__value').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('Message écranMessage écran');

        await wrapper.setProps({ io: { ...wrapper.props('io'), state: 'Bonsoir' } });

        expect(wrapper.get('.var-string-io__text').text()).toBe('Bonsoir');
    });

    it('sends the raw text with NO prefix when the dialog is confirmed', async () => {
        const wrapper = mountString();
        const button = wrapper.get('.io-row button');
        expect(button.attributes('aria-label')).toBe(label('io.setText', 'Message écran'));
        expect(wrapper.findComponent(TextInputDialog).props('open')).toBe(false);

        await button.trigger('click');
        const dialog = wrapper.findComponent(TextInputDialog);
        expect(dialog.props('open')).toBe(true);
        // Seeded from the state, never from the name-as-placeholder display.
        expect(dialog.props('text')).toBe('Bonjour');
        expect(dialog.props('name')).toBe('Message écran');

        dialog.vm.$emit('confirm', 'set true');
        await wrapper.vm.$nextTick();

        // Verbatim: no 'set ' added, nothing trimmed. A value that happens to
        // look like a command is still just text.
        expect(sent).toEqual([
            '{"msg":"set_state","data":{"id":"output_9","value":"set true"}}',
        ]);
        expect(wrapper.findComponent(TextInputDialog).props('open')).toBe(false);
    });

    it('seeds the dialog with nothing when the row is showing its name', async () => {
        const wrapper = mountString({ state: '' });

        await wrapper.get('.io-row button').trigger('click');

        expect(wrapper.findComponent(TextInputDialog).props('text')).toBe('');
    });

    it('sends nothing when the dialog is cancelled', async () => {
        const wrapper = mountString();

        await wrapper.get('.io-row button').trigger('click');
        wrapper.findComponent(TextInputDialog).vm.$emit('cancel');
        await wrapper.vm.$nextTick();

        expect(sent).toEqual([]);
        expect(wrapper.findComponent(TextInputDialog).props('open')).toBe(false);
    });

    it('waits for the server before showing the new text', async () => {
        const wrapper = mountString({ state: 'Bonjour' });

        await wrapper.get('.io-row button').trigger('click');
        wrapper.findComponent(TextInputDialog).vm.$emit('confirm', 'Bonsoir');
        await wrapper.vm.$nextTick();

        // Not optimistic (docs/ARCHITECTURE.md): the row still reads what the
        // server last said, with the activity dot covering the wait.
        expect(wrapper.get('.var-string-io__text').text()).toBe('Bonjour');
        expect(wrapper.find('.io-row__pending').exists()).toBe(true);

        useHomeStore().handleEvent({ kind: 'io_changed', id: 'output_9', state: 'Bonsoir' });
        await wrapper.setProps({ io: { ...wrapper.props('io'), state: 'Bonsoir' } });

        expect(wrapper.get('.var-string-io__text').text()).toBe('Bonsoir');
        expect(wrapper.find('.io-row__pending').exists()).toBe(false);
    });

    it('offers nothing to press when a var_string is not in edit mode', () => {
        // The old template hid the IMAGE inside the anchor, leaving a live but
        // empty tap target; the gate is on the control itself here.
        // `var_string` is one of the three types where `rw` really does decide
        // (docs/ARCHITECTURE.md "The `rw` flag").
        const wrapper = mountString({ gui_type: 'var_string', rw: 'false' });

        expect(wrapper.findAll('button')).toHaveLength(0);
        expect(wrapper.find('.io-row__actions').exists()).toBe(false);
        expect(wrapper.get('.var-string-io__text').text()).toBe('Bonjour');
    });

    it('keeps a string_out writable whatever rw says', () => {
        // The two wire types share this component but not the gate: a
        // `string_out` is an output, the server sends no `rw` for it, and
        // calaos_mobile spells the exception out in IOVarString.qml —
        // `visible: (rw || ioType === StringOut) && ioType !== StringIn`.
        for (const rw of ['false', 'true', undefined]) {
            const wrapper = mountString({ gui_type: 'string_out', rw });

            expect(wrapper.findAll('button'), `rw=${rw}`).toHaveLength(1);
            expect(wrapper.find('.io-row__actions').exists()).toBe(true);
        }
    });
});
