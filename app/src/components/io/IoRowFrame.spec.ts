import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import IoRowFrame from './IoRowFrame.vue';
import en from '../../i18n/en.json';

// The row frame carries a translated sensor badge, so every row needs the
// catalogue even when the row itself shows no text of its own.
const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });

describe('IoRowFrame', () => {
    it('shows the name and, by default, nothing else', () => {
        const wrapper = mount(IoRowFrame, { props: { name: 'Plafonnier' }, global: { plugins: [i18n] } });

        expect(wrapper.get('.io-row__name').text()).toBe('Plafonnier');
        // The value and action wrappers are not empty boxes waiting to be
        // filled: a row with no reading must not carry a reading's gap.
        expect(wrapper.find('.io-row__value').exists()).toBe(false);
        expect(wrapper.find('.io-row__actions').exists()).toBe(false);
        expect(wrapper.find('.io-row__note').exists()).toBe(false);
    });

    it('fills the glyph, value and action slots', () => {
        const wrapper = mount(IoRowFrame, {
            props: { name: 'Température' },
            global: { plugins: [i18n] },
            slots: {
                icon: '<svg class="glyph" />',
                value: '21.5 °C',
                actions: '<button class="act">go</button>',
            },
        });

        expect(wrapper.find('.io-row__lead svg.glyph').exists()).toBe(true);
        expect(wrapper.get('.io-row__value').text()).toBe('21.5 °C');
        expect(wrapper.find('.io-row__actions button.act').exists()).toBe(true);
    });

    it('carries a note in the eyebrow when it is given one', () => {
        const wrapper = mount(IoRowFrame, { props: { name: 'Chaudière', note: 'my_type' }, global: { plugins: [i18n] } });

        expect(wrapper.get('.io-row__note').text()).toBe('my_type');
    });

    it('shows the activity dot and marks itself busy while a set_state is out', async () => {
        const wrapper = mount(IoRowFrame, { props: { name: 'Plafonnier' }, global: { plugins: [i18n] } });
        expect(wrapper.find('.io-row__pending').exists()).toBe(false);
        expect(wrapper.attributes('aria-busy')).toBeUndefined();

        await wrapper.setProps({ pending: true });

        expect(wrapper.find('.io-row__pending').exists()).toBe(true);
        expect(wrapper.attributes('aria-busy')).toBe('true');
        // Decoration: `aria-busy` is what assistive tech reads, and a live
        // region per row would have a dozen of them talking at once.
        expect(wrapper.get('.io-row__pending').attributes('aria-hidden')).toBe('true');

        await wrapper.setProps({ pending: false });
        expect(wrapper.find('.io-row__pending').exists()).toBe(false);
    });

    describe('opens', () => {
        const open = (props: Record<string, unknown> = {}) =>
            mount(IoRowFrame, { props: { name: 'Clim', opens: true, ...props }, global: { plugins: [i18n] } });

        it('is a plain row, not a button, unless it opens a view', () => {
            const wrapper = mount(IoRowFrame, { props: { name: 'Plafonnier' }, global: { plugins: [i18n] } });
            expect(wrapper.attributes('role')).toBeUndefined();
            expect(wrapper.attributes('tabindex')).toBeUndefined();
            expect(wrapper.classes()).not.toContain('io-row--opens');
        });

        it('becomes a focusable button that says whether its view is showing', async () => {
            const wrapper = open();
            expect(wrapper.attributes('role')).toBe('button');
            expect(wrapper.attributes('tabindex')).toBe('0');
            expect(wrapper.attributes('aria-expanded')).toBe('false');

            await wrapper.setProps({ expanded: true });
            expect(wrapper.attributes('aria-expanded')).toBe('true');
        });

        it('emits open on a click and on Enter', async () => {
            const wrapper = open();
            await wrapper.trigger('click');
            await wrapper.trigger('keydown', { key: 'Enter' });
            expect(wrapper.emitted('open')).toHaveLength(2);
        });

        it('opens on the release of Space, not on its press, like a button does', async () => {
            const wrapper = open();
            // Firefox fires a click on the release: opening on the press would
            // leave that click on whatever the opened view put under the finger.
            await wrapper.trigger('keydown', { key: ' ' });
            expect(wrapper.emitted('open')).toBeUndefined();

            await wrapper.trigger('keyup', { key: ' ' });
            expect(wrapper.emitted('open')).toHaveLength(1);
        });

        it('keeps Space from scrolling the page while it is pressed', () => {
            const wrapper = open();
            const event = new KeyboardEvent('keydown', { key: ' ', cancelable: true, bubbles: true });
            wrapper.element.dispatchEvent(event);

            expect(event.defaultPrevented).toBe(true);
        });

        it('ignores other keys, and keys typed in something inside it', async () => {
            const wrapper = open();
            await wrapper.trigger('keydown', { key: 'a' });
            await wrapper.trigger('keydown', { key: 'Tab' });
            expect(wrapper.emitted('open')).toBeUndefined();

            const nested = mount(IoRowFrame, {
                props: { name: 'Clim', opens: true },
                global: { plugins: [i18n] },
                slots: { actions: '<button class="inner">x</button>' },
            });
            await nested.get('.inner').trigger('keydown', { key: 'Enter' });
            await nested.get('.inner').trigger('keyup', { key: ' ' });
            expect(nested.emitted('open')).toBeUndefined();
        });

        it('does nothing when it does not open anything', async () => {
            const wrapper = mount(IoRowFrame, { props: { name: 'Plafonnier' }, global: { plugins: [i18n] } });
            await wrapper.trigger('click');
            await wrapper.trigger('keydown', { key: 'Enter' });
            expect(wrapper.emitted('open')).toBeUndefined();
        });
    });
});
