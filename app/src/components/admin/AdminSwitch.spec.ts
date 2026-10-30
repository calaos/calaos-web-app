import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import AdminSwitch from './AdminSwitch.vue';

describe('AdminSwitch', () => {
    it('states its position to assistive technology', () => {
        const wrapper = mount(AdminSwitch, { props: { checked: true, label: 'On' } });
        const control = wrapper.get('[role="switch"]');
        expect(control.attributes('aria-checked')).toBe('true');
        expect(control.text()).toBe('On');
        expect(control.attributes('aria-busy')).toBeUndefined();
    });

    it('waits while busy or disabled', () => {
        const wrapper = mount(AdminSwitch, { props: { checked: false, label: 'Off', disabled: true, busy: true } });
        const control = wrapper.get('[role="switch"]');
        expect(control.attributes('aria-checked')).toBe('false');
        expect(control.attributes('disabled')).toBeDefined();
        expect(control.attributes('aria-busy')).toBe('true');
    });
});
