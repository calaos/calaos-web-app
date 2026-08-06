<script setup lang="ts">
// The app's only modal. Everything that interrupts — the colour picker, the
// text field — is this shell with something in its body slot.
//
// The old app used ngDialog with `closeByDocument: false`, and that one option
// is the whole behavioural brief: on a wall-mounted tablet a modal is a thing
// you have walked up to and touched, and a stray palm on the darkness around
// it must not throw the edit away. So the backdrop is inert — it darkens and
// it swallows the tap, and nothing else. Escape still closes (ngDialog's
// `closeByEscape` default), because a keyboard user needs a way out that is
// not a mouse.
//
// What ngDialog never did, and what makes this worth writing rather than
// reaching for a <dialog> polyfill: focus. It is moved into the panel on open,
// Tab cycles inside it instead of walking off into the room behind, and it
// goes back to the control that opened the dialog on close. Native <dialog>
// with showModal() gives the trap for free but not the styling — its ::backdrop
// cannot carry the pool of darkness this design wants, and Safari's support
// history is exactly the kind of thing that breaks a wall panel nobody updates.
//
// Design: the backdrop is not a flat grey scrim but the login screen's pool of
// darkness — a radial gradient deepest under the panel. The signature is the
// FILAMENT along the panel's top edge: the same 2px band of cyan light that
// underlines a focused login field and travels under the active footer tab,
// here marking which layer is live.
//
// The confirm/cancel pair lives HERE rather than in each dialog's slot, so
// that every modal in the app agrees on where its buttons are, what they look
// like, and that Enter submits. The payload is the child's business: this
// component emits a bare `confirm` and the wrapper turns it into its own typed
// event (a hex, a line of text).

import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';

const props = withDefaults(
    defineProps<{
        /** Mounted and visible only while true; teleported to <body>. */
        open: boolean;
        /** The job the dialog does, e.g. "Set color". Names the panel for AT. */
        title: string;
        /**
         * What is being edited — the IO's name, in the app's eyebrow type.
         * Server data, never translated.
         */
        eyebrow?: string;
        /** Copy for the primary button. Same words as the control that opened it. */
        confirmLabel: string;
        cancelLabel: string;
        /** Greys the primary button; Enter is refused too. */
        confirmDisabled?: boolean;
    }>(),
    { eyebrow: '', confirmDisabled: false },
);

const emit = defineEmits<{ confirm: []; cancel: [] }>();

const panel = ref<HTMLElement | null>(null);
const titleId = useId();

/** The control that had focus when the dialog opened, to give it back. */
let opener: HTMLElement | null = null;
/** `document.body`'s own overflow, restored when the dialog goes away. */
let bodyOverflow = '';
let scrollLocked = false;

function lockScroll(): void {
    if (scrollLocked) return;
    bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    scrollLocked = true;
}

// Also on unmount, not only on close: a dialog can be torn down while open
// (a route change, an IO that vanished from the house), and a page left
// permanently unscrollable is the classic way that goes wrong.
function unlockScroll(): void {
    if (!scrollLocked) return;
    document.body.style.overflow = bodyOverflow;
    scrollLocked = false;
}

onBeforeUnmount(unlockScroll);

// Deliberately not the exhaustive tabbable selector a library would ship: a
// dialog in this app holds buttons, a text field and a colour picker, and
// anything cleverer is untested surface. `[tabindex="-1"]` is excluded so the
// panel itself (which is focusable only as a fallback) never joins the cycle.
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

function focusables(): HTMLElement[] {
    if (panel.value === null) return [];
    return Array.from(panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) =>
            !element.hasAttribute('disabled') && element.getAttribute('tabindex') !== '-1',
    );
}

function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
        // Stopped here so an Escape meant for the dialog cannot also reach a
        // handler on the screen behind it.
        event.stopPropagation();
        emit('cancel');
        return;
    }
    if (event.key !== 'Tab') return;

    const items = focusables();
    if (items.length === 0) {
        event.preventDefault();
        return;
    }

    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && panel.value?.contains(active) === true;

    // Leaving by either end wraps to the other. Focus that somehow escaped the
    // panel is pulled back in rather than left in the room behind.
    if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        first.focus();
    }
}

watch(
    () => props.open,
    async (open) => {
        if (open) {
            opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            lockScroll();
            await nextTick();
            // `[data-autofocus]` is how a body says which of its controls is
            // the point of the dialog — the text field, not the Cancel button.
            const target =
                panel.value?.querySelector<HTMLElement>('[data-autofocus]') ??
                focusables()[0] ??
                panel.value;
            target?.focus();
        } else {
            unlockScroll();
            // Back to the button that opened it: after "Cancel" the thing you
            // reach for is the control you just came from.
            opener?.focus();
            opener = null;
        }
    },
);
</script>

<template>
    <Teleport to="body">
        <!-- @mousedown.self.prevent is the inert backdrop: preventDefault on
             mousedown keeps focus inside the panel (so Escape keeps working),
             and there is deliberately no @click that closes. -->
        <div v-if="open" class="base-dialog fade-in" @keydown="onKeydown" @mousedown.self.prevent>
            <div
                ref="panel"
                class="base-dialog__panel fade-in-up"
                role="dialog"
                aria-modal="true"
                :aria-labelledby="titleId"
                tabindex="-1"
            >
                <!-- A plain div, not <header>: the panel is teleported to
                     <body>, and a <header> with no sectioning ancestor maps
                     to the `banner` landmark — so an open dialog gave the
                     page a second banner alongside the navbar. The <h2> is
                     what carries the structure here anyway. -->
                <div class="base-dialog__head">
                    <p v-if="eyebrow !== ''" class="base-dialog__eyebrow">{{ eyebrow }}</p>
                    <h2 :id="titleId" class="base-dialog__title">{{ title }}</h2>
                </div>

                <!-- A real form, so Enter in a field confirms. -->
                <form class="base-dialog__form" @submit.prevent="emit('confirm')">
                    <div class="base-dialog__body"><slot /></div>

                    <div class="base-dialog__actions">
                        <button
                            type="button"
                            class="base-dialog__button base-dialog__button--quiet pressable"
                            @click="emit('cancel')"
                        >
                            {{ cancelLabel }}
                        </button>
                        <button
                            type="submit"
                            class="base-dialog__button base-dialog__button--primary pressable"
                            :disabled="confirmDisabled"
                        >
                            {{ confirmLabel }}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
.base-dialog {
    position: fixed;
    inset: 0;
    /* Above --z-chrome (100): the navbar and the footer are furniture, and a
       modal that a tab bar can cover is not modal. */
    z-index: 200;
    display: flex;
    padding: var(--space-4);
    /* The login panel's device: not a flat scrim but a pool of darkness,
       deepest exactly where the panel sits. */
    background-color: rgba(0, 0, 0, 0.55);
    background-image: radial-gradient(
        ellipse at center,
        rgba(0, 0, 0, 0.82),
        rgba(0, 0, 0, 0.35) 70%
    );
}

.base-dialog__panel {
    position: relative;
    margin: auto;
    inline-size: min(22rem, 100%);
    /* Never taller than the room it is in; the body scrolls, the head and the
       buttons stay put (a Cancel you have to scroll to is a trap). */
    max-block-size: 100%;
    display: flex;
    flex-direction: column;
    padding: var(--space-6);
    background-color: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-lg);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
}

.base-dialog__panel:focus-visible {
    outline: none;
}

/* The filament — the login field's focus band and the footer's travelling
   light, here saying which layer is live. The one bright thing on the panel. */
.base-dialog__panel::before {
    content: '';
    position: absolute;
    inset-block-start: -1px;
    inset-inline: 14%;
    block-size: 2px;
    background-image: linear-gradient(
        90deg,
        transparent,
        var(--c-accent) 30%,
        var(--c-accent) 70%,
        transparent
    );
    box-shadow: 0 0 12px var(--c-accent-glow);
    pointer-events: none;
}

.base-dialog__eyebrow {
    /* The app's label-that-names type: room type on the home tiles, the IO's
       own name here. */
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.base-dialog__title {
    margin-block-start: var(--space-1);
    font-size: 1.25rem;
    font-weight: 400;
    letter-spacing: var(--tracking-tight);
    line-height: 1.2;
}

.base-dialog__form {
    display: contents;
}

.base-dialog__body {
    margin-block-start: var(--space-6);
    /* The only scroller in the panel — and the only flex item allowed to
       shrink, which `min-block-size: 0` is what actually permits. */
    min-block-size: 0;
    overflow-y: auto;
}

.base-dialog__actions {
    display: flex;
    gap: var(--space-3);
    margin-block-start: var(--space-6);
}

.base-dialog__button {
    flex: 1;
    /* 44px, the app's smallest reliable tap target (see LoginView). */
    min-block-size: 2.75rem;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition:
        background-color 200ms ease,
        border-color 200ms ease,
        transform var(--press-duration) ease;
}

.base-dialog__button--quiet {
    background-color: transparent;
    border: 1px solid var(--c-border);
    color: var(--c-text-muted);
}

.base-dialog__button--quiet:hover {
    border-color: var(--c-text-muted);
    color: var(--c-text);
}

.base-dialog__button--primary {
    border: 0;
    background-color: var(--c-accent);
    /* Near-black on cyan, as on the login button. */
    color: #04222b;
    box-shadow: 0 0 18px var(--c-accent-glow);
}

.base-dialog__button--primary:hover:not(:disabled) {
    background-color: #4cc0e2;
}

.base-dialog__button--primary:disabled {
    background-color: rgba(255, 255, 255, 0.08);
    color: var(--c-text-muted);
    box-shadow: none;
    cursor: not-allowed;
}

@media (prefers-reduced-motion: reduce) {
    .base-dialog__button {
        transition: none;
    }
}
</style>
