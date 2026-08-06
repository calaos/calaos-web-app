import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import IconButton from './IconButton.vue';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('IconButton', () => {
    it('exposes its label to assistive tech and as a tooltip', () => {
        const wrapper = mount(IconButton, { props: { label: 'Sign out' } });

        expect(wrapper.attributes('aria-label')).toBe('Sign out');
        expect(wrapper.attributes('title')).toBe('Sign out');
        // Never a submit button: these live inside the login form's page too.
        expect(wrapper.attributes('type')).toBe('button');
    });

    it('warns when mounted without a label', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // @ts-expect-error — the point of the test: `label` is required, and
        // omitting it is a type error as well as a runtime warning.
        mount(IconButton, { props: {} });

        expect(warn).toHaveBeenCalled();
        expect(warn.mock.calls.flat().join(' ')).toContain('label');
    });

    it('is pressable and hides the icon from the a11y tree', () => {
        const wrapper = mount(IconButton, {
            props: { label: 'Back' },
            slots: { default: '<svg class="glyph" />' },
        });

        expect(wrapper.classes()).toContain('pressable');
        expect(wrapper.find('.icon-button__glyph').attributes('aria-hidden')).toBe('true');
        expect(wrapper.find('svg.glyph').exists()).toBe(true);
    });

    it('drops the raised chrome in the bare variant', () => {
        const raised = mount(IconButton, { props: { label: 'Back' } });
        const bare = mount(IconButton, { props: { label: 'Back', variant: 'bare' } });

        expect(raised.classes()).toContain('icon-button--raised');
        expect(bare.classes()).toContain('icon-button--bare');
    });

    it('emits click through to the parent', async () => {
        const wrapper = mount(IconButton, { props: { label: 'Back' } });

        await wrapper.trigger('click');

        expect(wrapper.emitted('click')).toHaveLength(1);
    });
});
