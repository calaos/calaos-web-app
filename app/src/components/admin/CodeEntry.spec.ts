import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '../../i18n/en.json';
import fr from '../../i18n/fr.json';
import { toAdminError } from '../../protocol/admin';
import type { Challenge } from '../../stores/approvers';
import CodeEntry from './CodeEntry.vue';

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);

function challenge(patch: Partial<Challenge> = {}): Challenge {
    return {
        step: 'password',
        codeId: 'eeeeeeeeeeeeeeee',
        phone: 'Pixel 8',
        expiresAt: NOW + 60_000,
        resendAt: NOW + 10_000,
        attemptsLeft: null,
        error: null,
        ...patch,
    };
}

function mountEntry(props: { challenge: Challenge; working?: 'sending' | 'checking' | null }, locale: 'en' | 'fr' = 'en') {
    return mount(CodeEntry, {
        props: { working: null, ...props },
        global: { plugins: [createI18n({ legacy: false, locale, messages: { en, fr } })] },
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('CodeEntry', () => {
    it('names the phone, counts down, and submits on the sixth digit', async () => {
        const wrapper = mountEntry({ challenge: challenge() });
        expect(wrapper.text()).toContain('Enter the code received on Pixel 8 to change the admin password.');
        expect(wrapper.text()).toContain('Valid for 60 more s');

        const input = wrapper.find('input');
        await input.setValue('12a34');
        expect(wrapper.findAll('.code-entry__cell').map((cell) => cell.text())).toEqual(['1', '2', '3', '4', '', '']);
        expect(wrapper.emitted('submit')).toBeUndefined();
        await input.setValue('123456');
        expect(wrapper.emitted('submit')).toEqual([['123456']]);

        vi.advanceTimersByTime(15_000);
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toContain('Valid for 45 more s');
    });

    it('waits the 10 s before offering a new code', async () => {
        const wrapper = mountEntry({ challenge: challenge() });
        const resend = wrapper.find('.code-entry__resend-button');
        expect(resend.attributes('disabled')).toBeDefined();
        expect(resend.text()).toBe('Send a new code in 10 s');
        vi.advanceTimersByTime(10_000);
        await wrapper.vm.$nextTick();
        expect(resend.attributes('disabled')).toBeUndefined();
        await resend.trigger('click');
        expect(wrapper.emitted('resend')).toHaveLength(1);
    });

    it('says when the code is wrong, with the attempts left, and when it has expired', async () => {
        const wrapper = mountEntry({
            challenge: challenge({
                attemptsLeft: 2,
                error: toAdminError({ success: 'false', error: 'bad_code', attempts_left: '2' }),
            }),
        });
        expect(wrapper.find('[role="alert"]').text()).toBe('Wrong code. 2 attempts left.');

        await wrapper.setProps({ challenge: challenge({ error: null }) });
        vi.advanceTimersByTime(61_000);
        await wrapper.vm.$nextTick();
        expect(wrapper.find('[role="alert"]').text()).toBe('This code has expired. Ask for a new one.');
        expect(wrapper.find('.code-entry__submit').attributes('disabled')).toBeDefined();
    });

    it('keeps an RTL-override phone name inside its own isolate', () => {
        const name = '\u202Eenohp liveE';
        const wrapper = mountEntry({ challenge: challenge({ phone: name }) });
        const hint = wrapper.find('.code-entry__hint');
        expect(hint.find('bdi').text()).toBe(name);
        expect(hint.text().startsWith('Enter the code received on ')).toBe(true);
        expect(hint.text().endsWith(' to change the admin password.')).toBe(true);
    });

    it('speaks French', () => {
        const wrapper = mountEntry({ challenge: challenge({ step: 'confirm_enroll', phone: 'iPhone' }) }, 'fr');
        expect(wrapper.text()).toContain('Un code vient d’être envoyé sur iPhone.');
        expect(wrapper.text()).toContain('Valable encore 60 s');
    });
});
