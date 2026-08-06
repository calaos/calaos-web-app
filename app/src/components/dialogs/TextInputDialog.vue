<script setup lang="ts">
// Type a line of text for a var_string / string_out IO.
//
// The contract is the raw string, unchanged: whatever is in the field is what
// goes on the wire (old StringDialogCtrl sent `$scope.text` verbatim, with no
// `set ` prefix — see io-states.ts `setText`). Nothing is trimmed. A trailing
// space may be exactly what the house's display board wants, and an empty
// field is how you clear one, so neither is second-guessed here.
//
// The field is focused on open but NOT selected — same reasoning as the login
// screen's password field: on a touch panel a pre-selected value is one stray
// tap away from being replaced wholesale, and this dialog exists to edit a
// value, not to retype it.

import { ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseDialog from '../ui/BaseDialog.vue';

const props = withDefaults(
    defineProps<{
        open: boolean;
        /** Current value, seeded into the field each time it opens. */
        text: string;
        /** The IO's name, shown as the panel's eyebrow. Server data. */
        name?: string;
    }>(),
    { name: '' },
);

const emit = defineEmits<{
    /** The field's contents, raw. */
    confirm: [text: string];
    cancel: [];
}>();

const { t } = useI18n();
const fieldId = useId();

const draft = ref(props.text);

// Re-seeded on open only: a server-side change arriving mid-edit must not
// overwrite what is being typed.
watch(
    () => props.open,
    (open) => {
        if (open) draft.value = props.text;
    },
);
</script>

<template>
    <BaseDialog
        :open="open"
        :eyebrow="name"
        :title="t('dialog.text.title')"
        :confirm-label="t('dialog.text.confirm')"
        :cancel-label="t('dialog.cancel')"
        @confirm="emit('confirm', draft)"
        @cancel="emit('cancel')"
    >
        <label class="text-dialog__label" :for="fieldId">{{ t('dialog.text.label') }}</label>
        <div class="text-dialog__control">
            <input
                :id="fieldId"
                v-model="draft"
                data-autofocus
                class="text-dialog__input"
                type="text"
                autocomplete="off"
                autocapitalize="sentences"
                spellcheck="false"
            />
        </div>
    </BaseDialog>
</template>

<style scoped>
.text-dialog__label {
    display: block;
    margin-block-end: var(--space-2);
    /* The login form's field label: wide, uppercase, small. */
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text-muted);
}

.text-dialog__control {
    position: relative;
}

.text-dialog__input {
    display: block;
    inline-size: 100%;
    padding: var(--space-3) var(--space-4);
    appearance: none;
    background-color: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: var(--radius-md);
    color: var(--c-text);
    font-size: 1rem;
    transition:
        background-color 200ms ease,
        border-color 200ms ease;
}

.text-dialog__input:focus,
.text-dialog__input:focus-visible {
    outline: none;
}

.text-dialog__control:focus-within .text-dialog__input {
    background-color: rgba(255, 255, 255, 0.1);
    border-color: rgba(56, 176, 211, 0.55);
}

/* The filament, one field wide — the login screen's focus band, so a field is
   a field wherever it appears. */
.text-dialog__control::after {
    content: '';
    position: absolute;
    inset-block-end: 0;
    inset-inline: 8%;
    block-size: 2px;
    background-image: linear-gradient(
        90deg,
        transparent,
        var(--c-accent) 30%,
        var(--c-accent) 70%,
        transparent
    );
    box-shadow: 0 0 12px var(--c-accent-glow);
    transform: scaleX(0);
    opacity: 0;
    transition:
        transform 260ms cubic-bezier(0.22, 0.61, 0.36, 1),
        opacity 200ms ease;
    pointer-events: none;
}

.text-dialog__control:focus-within::after {
    transform: scaleX(1);
    opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
    .text-dialog__input,
    .text-dialog__control::after {
        transition: none;
    }
}
</style>
