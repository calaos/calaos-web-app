import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { Chrome } from '@ckpack/vue-color';
import ColorPickerDialog from './ColorPickerDialog.vue';
import en from '../../i18n/en.json';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });

function mountDialog(props: Record<string, unknown> = {}) {
    return mount(ColorPickerDialog, {
        props: { open: true, color: '#336699', ...props },
        global: { plugins: [i18n] },
        attachTo: document.body,
    });
}

/** What the picker widget reports when the user drags — @ckpack sends UPPERCASE. */
function pick(wrapper: ReturnType<typeof mountDialog>, hex: string) {
    return wrapper.findComponent(Chrome).vm.$emit('update:modelValue', { hex });
}

let wrapper: ReturnType<typeof mountDialog>;

beforeEach(() => {
    document.body.innerHTML = '';
});

afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = '';
});

describe('ColorPickerDialog', () => {
    it('says which IO it is editing and what pressing the button will do', async () => {
        wrapper = mountDialog({ name: 'Bandeau LED' });
        await nextTick();

        expect(document.querySelector('.base-dialog__eyebrow')?.textContent).toBe('Bandeau LED');
        expect(document.querySelector('.base-dialog__title')?.textContent).toBe(
            en.dialog.color.title,
        );
        const [cancel, confirm] = document.querySelectorAll('.base-dialog__button');
        expect(cancel.textContent?.trim()).toBe(en.dialog.cancel);
        expect(confirm.textContent?.trim()).toBe(en.dialog.color.confirm);
    });

    it('emits the colour as lowercase #rrggbb, whatever the widget reported', async () => {
        wrapper = mountDialog();
        await pick(wrapper, '#FF8800');
        await nextTick();

        expect(document.querySelector('.color-dialog__hex')?.textContent).toBe('#ff8800');

        (document.querySelectorAll('.base-dialog__button')[1] as HTMLButtonElement).click();
        await nextTick();

        expect(wrapper.emitted('confirm')).toEqual([['#ff8800']]);
    });

    it('expands the three-digit hex an off lamp arrives with', async () => {
        // `parseLightRgb` maps the state '0' to '#000', so this is the shape
        // the row hands over every time a dark lamp is opened.
        wrapper = mountDialog({ color: '#000' });
        await nextTick();

        expect(document.querySelector('.color-dialog__hex')?.textContent).toBe('#000000');
    });

    it('falls back to black for a state that is not a colour at all', async () => {
        wrapper = mountDialog({ color: 'true' });
        await nextTick();

        expect(document.querySelector('.color-dialog__hex')?.textContent).toBe('#000000');
    });

    it('emits nothing at all when cancelled', async () => {
        wrapper = mountDialog();
        await pick(wrapper, '#123456');

        (document.querySelectorAll('.base-dialog__button')[0] as HTMLButtonElement).click();
        await nextTick();

        expect(wrapper.emitted('cancel')).toHaveLength(1);
        expect(wrapper.emitted('confirm')).toBeUndefined();
    });

    it('re-reads the IO colour every time it opens, discarding the abandoned draft', async () => {
        wrapper = mountDialog({ open: false, color: '#336699' });
        await wrapper.setProps({ open: true });
        await pick(wrapper, '#ABCDEF');
        await nextTick();
        expect(document.querySelector('.color-dialog__hex')?.textContent).toBe('#abcdef');

        await wrapper.setProps({ open: false });
        await wrapper.setProps({ open: true });
        await nextTick();

        expect(document.querySelector('.color-dialog__hex')?.textContent).toBe('#336699');
    });

    it('never pushes the draft back into the widget', async () => {
        // Hex is a lossy round trip through HSV: re-seeding on every drag
        // would reset the hue whenever the colour passed through grey, and an
        // off lamp opens this dialog on black every time.
        wrapper = mountDialog({ color: '#336699' });
        const seeded = wrapper.findComponent(Chrome).props('modelValue');

        await pick(wrapper, '#000000');
        await pick(wrapper, '#ABCDEF');

        expect(wrapper.findComponent(Chrome).props('modelValue')).toBe(seeded);
        expect(document.querySelector('.color-dialog__hex')?.textContent).toBe('#abcdef');
    });

    it('ignores a colour arriving from the server while it is open', async () => {
        // Another client or a scenario can change the lamp mid-drag; the field
        // must not jump out from under the thumb.
        wrapper = mountDialog({ color: '#336699' });
        await pick(wrapper, '#111111');

        await wrapper.setProps({ color: '#ff0000' });
        await nextTick();

        expect(document.querySelector('.color-dialog__hex')?.textContent).toBe('#111111');
    });
});
