import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import TextInputDialog from './TextInputDialog.vue';
import en from '../../i18n/en.json';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });

function mountDialog(props: Record<string, unknown> = {}) {
    return mount(TextInputDialog, {
        props: { open: true, text: '', ...props },
        global: { plugins: [i18n] },
        attachTo: document.body,
    });
}

function field(): HTMLInputElement {
    const input = document.querySelector<HTMLInputElement>('.text-dialog__input');
    if (input === null) throw new Error('dialog is not open');
    return input;
}

async function type(wrapper: ReturnType<typeof mountDialog>, value: string) {
    field().value = value;
    field().dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    return wrapper;
}

function buttons(): HTMLButtonElement[] {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('.base-dialog__button'));
}

let wrapper: ReturnType<typeof mountDialog>;

beforeEach(() => {
    document.body.innerHTML = '';
});

afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = '';
});

describe('TextInputDialog', () => {
    it('says which IO it is editing, and labels the field', async () => {
        wrapper = mountDialog({ name: 'Message écran' });
        await nextTick();

        expect(document.querySelector('.base-dialog__eyebrow')?.textContent).toBe('Message écran');
        expect(document.querySelector('.base-dialog__title')?.textContent).toBe(
            en.dialog.text.title,
        );

        const label = document.querySelector('.text-dialog__label') as HTMLLabelElement;
        expect(label.textContent).toBe(en.dialog.text.label);
        // A real label/field pair, not a placeholder pretending to be one.
        expect(label.getAttribute('for')).toBe(field().id);
        expect(field().id).toBeTruthy();
    });

    it('seeds the field with the current value and focuses it', async () => {
        wrapper = mountDialog({ open: false, text: 'Bonjour' });
        await wrapper.setProps({ open: true });
        await nextTick();

        expect(field().value).toBe('Bonjour');
        // `data-autofocus` wins over document order — the point of the dialog
        // is the field, not the Cancel button that precedes it in the panel.
        expect(document.activeElement).toBe(field());
    });

    it('emits the text exactly as typed — no prefix, no trimming', async () => {
        // The wire value for var_string IS the text (io-states.ts `setText`),
        // and a trailing space may be what the display board wants.
        wrapper = mountDialog({ text: 'old' });
        await type(wrapper, '  set true  ');

        buttons()[1].click();
        await nextTick();

        expect(wrapper.emitted('confirm')).toEqual([['  set true  ']]);
    });

    it('lets an empty field through, which is how a value is cleared', async () => {
        wrapper = mountDialog({ text: 'something' });
        await type(wrapper, '');

        buttons()[1].click();
        await nextTick();

        expect(wrapper.emitted('confirm')).toEqual([['']]);
    });

    it('emits nothing at all when cancelled', async () => {
        wrapper = mountDialog({ text: 'old' });
        await type(wrapper, 'new');

        buttons()[0].click();
        await nextTick();

        expect(wrapper.emitted('cancel')).toHaveLength(1);
        expect(wrapper.emitted('confirm')).toBeUndefined();
    });

    it('confirms on Enter in the field', async () => {
        wrapper = mountDialog({ text: '' });
        await type(wrapper, 'Bonsoir');

        // Implicit form submission — the old dialog had no such path.
        document
            .querySelector('.base-dialog__form')
            ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await nextTick();

        expect(wrapper.emitted('confirm')).toEqual([['Bonsoir']]);
    });

    it('re-seeds on every open, discarding the abandoned draft', async () => {
        wrapper = mountDialog({ open: false, text: 'first' });
        await wrapper.setProps({ open: true });
        await type(wrapper, 'abandoned');

        await wrapper.setProps({ open: false });
        await wrapper.setProps({ text: 'second' });
        await wrapper.setProps({ open: true });
        await nextTick();

        expect(field().value).toBe('second');
    });

    it('ignores a value arriving from the server while it is open', async () => {
        wrapper = mountDialog({ text: 'first' });
        await type(wrapper, 'half typed');

        await wrapper.setProps({ text: 'from the server' });
        await nextTick();

        expect(field().value).toBe('half typed');
    });
});
