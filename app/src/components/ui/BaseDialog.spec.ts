import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import BaseDialog from './BaseDialog.vue';

// The dialog teleports to <body>, so nothing it renders is reachable through
// the wrapper: every query below goes through the document, and the component
// is attached to the document so focus() actually moves the active element
// (happy-dom, like a browser, refuses to focus a detached node).

const PANEL = '.base-dialog__panel';
const OVERLAY = '.base-dialog';

function panel(): HTMLElement {
    const element = document.querySelector<HTMLElement>(PANEL);
    if (element === null) throw new Error('dialog is not open');
    return element;
}

function buttons(): HTMLButtonElement[] {
    return Array.from(document.querySelectorAll<HTMLButtonElement>(`${PANEL} button`));
}

/** A key press on the overlay, where the component listens. */
function press(key: string, shiftKey = false): void {
    document
        .querySelector(OVERLAY)
        ?.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
}

function mountDialog(props: Record<string, unknown> = {}) {
    return mount(BaseDialog, {
        props: {
            open: false,
            title: 'Set color',
            confirmLabel: 'Set color',
            cancelLabel: 'Cancel',
            ...props,
        },
        slots: { default: '<input class="body-field" />' },
        attachTo: document.body,
    });
}

let wrapper: ReturnType<typeof mountDialog>;

beforeEach(() => {
    document.body.innerHTML = '';
});

afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = '';
});

describe('BaseDialog', () => {
    it('renders nothing at all until it is opened', async () => {
        wrapper = mountDialog();
        expect(document.querySelector(OVERLAY)).toBeNull();

        await wrapper.setProps({ open: true });

        expect(document.querySelector(OVERLAY)).not.toBeNull();
        expect(panel().getAttribute('role')).toBe('dialog');
        expect(panel().getAttribute('aria-modal')).toBe('true');
        // The title names the panel, so the label is a real element reference
        // rather than a duplicated string.
        const labelledBy = panel().getAttribute('aria-labelledby');
        expect(labelledBy).toBeTruthy();
        expect(document.getElementById(labelledBy as string)?.textContent).toBe('Set color');
    });

    it('does NOT close when the backdrop is clicked', async () => {
        // The old app's ngDialog `closeByDocument: false`, kept deliberately: a
        // wall panel collects stray taps and a half-typed value must survive.
        wrapper = mountDialog({ open: true });
        await nextTick();

        const overlay = document.querySelector(OVERLAY) as HTMLElement;
        overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await nextTick();

        expect(wrapper.emitted('cancel')).toBeUndefined();
        expect(document.querySelector(OVERLAY)).not.toBeNull();
    });

    it('closes on Escape', async () => {
        wrapper = mountDialog({ open: true });
        await nextTick();

        press('Escape');
        await nextTick();

        expect(wrapper.emitted('cancel')).toHaveLength(1);
    });

    it('traps Tab inside the panel, in both directions', async () => {
        wrapper = mountDialog({ open: true });
        await nextTick();

        const field = document.querySelector<HTMLElement>('.body-field') as HTMLElement;
        const [cancel, confirm] = buttons();

        // Forward off the last control wraps to the first.
        confirm.focus();
        press('Tab');
        expect(document.activeElement).toBe(field);

        // Backward off the first wraps to the last.
        field.focus();
        press('Tab', true);
        expect(document.activeElement).toBe(confirm);

        // And in between, Tab is left alone for the browser to handle.
        cancel.focus();
        press('Tab');
        expect(document.activeElement).toBe(cancel);
    });

    it('moves focus to the body control on open and gives it back on close', async () => {
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        opener.focus();

        wrapper = mountDialog();
        await wrapper.setProps({ open: true });
        await nextTick();

        // `[data-autofocus]` is absent here, so the first focusable wins — and
        // the body's field comes before the buttons in the panel.
        expect(document.activeElement).toBe(document.querySelector('.body-field'));

        await wrapper.setProps({ open: false });
        await nextTick();

        expect(document.activeElement).toBe(opener);
    });

    it('honours [data-autofocus] over document order', async () => {
        wrapper = mount(BaseDialog, {
            props: {
                open: false,
                title: 'Set text',
                confirmLabel: 'Set text',
                cancelLabel: 'Cancel',
            },
            slots: {
                default: '<input class="first" /><input class="chosen" data-autofocus />',
            },
            attachTo: document.body,
        });

        await wrapper.setProps({ open: true });
        await nextTick();

        expect(document.activeElement).toBe(document.querySelector('.chosen'));
    });

    it('confirms on the primary button and on Enter in the body', async () => {
        wrapper = mountDialog({ open: true });
        await nextTick();

        buttons()[1].click();
        await nextTick();
        expect(wrapper.emitted('confirm')).toHaveLength(1);

        // Implicit submission: the body is inside a real <form>.
        document
            .querySelector('.base-dialog__form')
            ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await nextTick();
        expect(wrapper.emitted('confirm')).toHaveLength(2);
    });

    it('cancels on the quiet button, and never confirms by doing so', async () => {
        wrapper = mountDialog({ open: true });
        await nextTick();

        buttons()[0].click();
        await nextTick();

        expect(wrapper.emitted('cancel')).toHaveLength(1);
        expect(wrapper.emitted('confirm')).toBeUndefined();
    });

    it('refuses to confirm while the primary button is disabled', async () => {
        wrapper = mountDialog({ open: true, confirmDisabled: true });
        await nextTick();

        expect(buttons()[1].disabled).toBe(true);
        buttons()[1].click();
        await nextTick();

        expect(wrapper.emitted('confirm')).toBeUndefined();
    });

    it('names what is being edited above the title, and omits the line when it is not given', async () => {
        wrapper = mountDialog({ open: true });
        await nextTick();
        expect(document.querySelector('.base-dialog__eyebrow')).toBeNull();

        await wrapper.setProps({ eyebrow: 'Salon' });
        await nextTick();

        expect(document.querySelector('.base-dialog__eyebrow')?.textContent).toBe('Salon');
    });

    it('stops the page behind it from scrolling, and restores the page on close', async () => {
        wrapper = mountDialog();
        expect(document.body.style.overflow).toBe('');

        await wrapper.setProps({ open: true });
        await nextTick();
        expect(document.body.style.overflow).toBe('hidden');

        await wrapper.setProps({ open: false });
        await nextTick();
        expect(document.body.style.overflow).toBe('');
    });
});
