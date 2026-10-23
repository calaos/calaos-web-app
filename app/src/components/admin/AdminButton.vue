<script setup lang="ts">
// The login button and the dialog's quiet button, as one component with a
// progress state. With `href` it is a link in the same dress (a button
// nested in a link is invalid HTML).

import IconLoading from '~icons/mdi/loading';

withDefaults(
    defineProps<{
        variant?: 'primary' | 'quiet' | 'danger';
        type?: 'button' | 'submit';
        disabled?: boolean;
        /** Shows the spinner and the `busyLabel`; the button is inert meanwhile. */
        busy?: boolean;
        busyLabel?: string;
        /** Full width — the gate forms; rows keep the natural width. */
        block?: boolean;
        /** Renders an `<a>` instead of a `<button>`. */
        href?: string;
    }>(),
    {
        variant: 'primary',
        type: 'button',
        disabled: false,
        busy: false,
        busyLabel: undefined,
        block: false,
        href: undefined,
    },
);
</script>

<template>
    <a
        v-if="href !== undefined"
        :href="href"
        class="admin-button pressable"
        :class="[`admin-button--${variant}`, { 'admin-button--block': block }]"
    >
        <span><slot /></span>
    </a>
    <button
        v-else
        :type="type"
        class="admin-button pressable"
        :class="[`admin-button--${variant}`, { 'admin-button--block': block }]"
        :disabled="disabled || busy"
        :aria-busy="busy || undefined"
    >
        <IconLoading v-if="busy" class="admin-button__spinner" aria-hidden="true" />
        <span v-if="busy && busyLabel !== undefined">{{ busyLabel }}</span>
        <span v-else><slot /></span>
    </button>
</template>

<style scoped>
.admin-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    /* 44px, the app's smallest reliable tap target. */
    min-block-size: 2.75rem;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    text-decoration: none;
    transition:
        background-color 200ms ease,
        border-color 200ms ease,
        color 200ms ease,
        box-shadow 200ms ease,
        transform var(--press-duration) ease;
}

.admin-button--block {
    display: flex;
    inline-size: 100%;
}

.admin-button--primary {
    border: 0;
    background-color: var(--c-accent);
    color: #04222b;
    box-shadow: 0 0 18px var(--c-accent-glow);
}

.admin-button--primary:hover:not(:disabled) {
    background-color: #4cc0e2;
}

.admin-button--quiet {
    background-color: transparent;
    border: 1px solid var(--c-border-strong);
    color: var(--c-text);
}

.admin-button--quiet:hover:not(:disabled) {
    border-color: var(--c-accent);
    color: var(--c-accent);
}

.admin-button--danger {
    background-color: transparent;
    border: 1px solid rgba(224, 86, 86, 0.5);
    color: var(--c-danger);
}

.admin-button--danger:hover:not(:disabled) {
    background-color: rgba(224, 86, 86, 0.12);
}

.admin-button:disabled {
    cursor: not-allowed;
}

.admin-button--primary:disabled {
    background-color: rgba(255, 255, 255, 0.08);
    color: var(--c-text-muted);
    box-shadow: none;
}

.admin-button--quiet:disabled,
.admin-button--danger:disabled {
    border-color: var(--c-border);
    color: var(--c-text-muted);
}

.admin-button__spinner {
    font-size: 1.125rem;
    animation: admin-spin 900ms linear infinite;
}

@keyframes admin-spin {
    to {
        transform: rotate(360deg);
    }
}

@media (prefers-reduced-motion: reduce) {
    .admin-button {
        transition: none;
    }

    .admin-button__spinner {
        animation: none;
    }
}
</style>
