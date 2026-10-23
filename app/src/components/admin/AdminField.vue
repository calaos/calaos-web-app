<script setup lang="ts">
// A labelled text field in the login screen's dress: wide uppercase label,
// translucent box, and the filament along the bottom edge when focused.

import { onMounted, ref, useId } from 'vue';

const props = withDefaults(
    defineProps<{
        label: string;
        type?: 'text' | 'password';
        autocomplete?: string;
        autofocus?: boolean;
        disabled?: boolean;
        /** Ids of the messages that explain this field (aria-describedby). */
        describedBy?: string;
        invalid?: boolean;
    }>(),
    { type: 'text', autocomplete: 'off', autofocus: false, disabled: false, describedBy: undefined, invalid: false },
);

const model = defineModel<string>({ required: true });
const id = useId();
const input = ref<HTMLInputElement | null>(null);

// `data-autofocus` is what BaseDialog looks for when it opens; on a plain
// screen nobody else focuses anything, so the field does it itself.
onMounted(() => {
    if (props.autofocus) input.value?.focus();
});
</script>

<template>
    <div class="admin-field">
        <label class="admin-field__label" :for="id">{{ label }}</label>
        <div class="admin-field__control">
            <input
                :id="id"
                ref="input"
                v-model="model"
                class="admin-field__input"
                :type="type"
                :autocomplete="autocomplete"
                :data-autofocus="autofocus || undefined"
                :disabled="disabled"
                :aria-describedby="describedBy"
                :aria-invalid="invalid || undefined"
                autocapitalize="none"
                autocorrect="off"
                spellcheck="false"
            />
        </div>
    </div>
</template>

<style scoped>
.admin-field + .admin-field {
    margin-block-start: var(--space-4);
}

.admin-field__label {
    display: block;
    margin-block-end: var(--space-2);
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text-muted);
}

.admin-field__control {
    position: relative;
}

.admin-field__input {
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

.admin-field__input:disabled {
    opacity: 0.6;
}

.admin-field__input:focus,
.admin-field__input:focus-visible {
    outline: none;
}

.admin-field__control:focus-within .admin-field__input {
    background-color: rgba(255, 255, 255, 0.1);
    border-color: rgba(56, 176, 211, 0.55);
}

.admin-field__input[aria-invalid='true'] {
    border-color: rgba(224, 86, 86, 0.6);
}

/* The filament, one field wide — LoginView's focus band. */
.admin-field__control::after {
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

.admin-field__control:focus-within::after {
    transform: scaleX(1);
    opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
    .admin-field__input,
    .admin-field__control::after {
        transition: none;
    }
}
</style>
