import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import en from '../../i18n/en.json';
import fr from '../../i18n/fr.json';
import { useApproversStore } from '../../stores/approvers';
import ApproversPanel from './ApproversPanel.vue';

/** U+202E RIGHT-TO-LEFT OVERRIDE: unisolated, it would reverse what follows it. */
const RTL_NAME = '\u202Eenohp liveE';

function mountPanel() {
    return mount(ApproversPanel, {
        attachTo: document.body,
        global: {
            plugins: [createI18n({ legacy: false, locale: 'en', messages: { en, fr } })],
            stubs: { Teleport: true },
        },
    });
}

// Attached for the radio's native click; unmounted so tests do not stack up.
enableAutoUnmount(afterEach);

beforeEach(() => {
    setActivePinia(createPinia());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('ApproversPanel', () => {
    it('isolates an RTL-override name in the list, and always shows the reference', async () => {
        const wrapper = mountPanel();
        useApproversStore().approvers = [
            {
                id: '1111111111111111',
                deviceName: RTL_NAME,
                tokenId: '0c1d2e3f4a5b6c7d',
                createdAt: '2026-10-01T00:00:00Z',
                platform: 'android',
                registeredAt: '',
                lastSeen: new Date().toISOString(),
                secure: false,
            },
        ];
        await flushPromises();
        const name = wrapper.find('.approvers__row .approvers__name');
        expect(name.find('bdi').text()).toBe(RTL_NAME);
        expect(name.find('.approvers__ref').text()).toBe('Ref. 6c7d');
        // The reference stays outside the isolate, in reading order.
        expect(name.find('bdi').find('.approvers__ref').exists()).toBe(false);
    });

    it('isolates candidate names and marks the chosen one with more than colour', async () => {
        const wrapper = mountPanel();
        const approvers = useApproversStore();
        approvers.approvers = [];
        (wrapper.vm as unknown as { openAdd: () => void }).openAdd();
        approvers.candidates = [
            { tokenId: 'a1b2c3d4e5f60718', deviceName: RTL_NAME, platform: 'ios', registeredAt: '', lastSeen: '', approver: false, secure: false },
            { tokenId: '9f8e7d6c5b4a3921', deviceName: 'iPhone', platform: 'ios', registeredAt: '', lastSeen: '', approver: false, secure: false },
        ];
        await flushPromises();
        const choices = wrapper.findAll('.approvers__choice');
        expect(choices[0].find('bdi').text()).toBe(RTL_NAME);
        expect(wrapper.find('.approvers__check').exists()).toBe(false);
        (choices[1].find('input').element as HTMLInputElement).click();
        await flushPromises();
        expect(wrapper.findAll('.approvers__choice')[1].find('.approvers__check').exists()).toBe(true);
        expect((choices[1].find('input').element as HTMLInputElement).checked).toBe(true);
    });
});
