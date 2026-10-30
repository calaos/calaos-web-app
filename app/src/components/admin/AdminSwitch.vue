<script setup lang="ts">
// The admin pages' on/off switch. `label` is the visible text next to it;
// the caller gives its accessible name (aria-labelledby or aria-label).

defineProps<{
    checked: boolean;
    label: string;
    disabled?: boolean;
    busy?: boolean;
}>();
</script>

<template>
    <button
        type="button"
        role="switch"
        class="admin-switch pressable"
        :aria-checked="checked"
        :aria-busy="busy || undefined"
        :disabled="disabled"
    >
        <span class="admin-switch__track" aria-hidden="true"><span class="admin-switch__thumb" /></span>
        <span class="admin-switch__state">{{ label }}</span>
    </button>
</template>

<style scoped>
.admin-switch {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    min-block-size: 2.75rem;
    padding: 0;
    border: 0;
    background: none;
    color: var(--c-text-muted);
    font: inherit;
    font-size: 0.875rem;
    cursor: pointer;
}

.admin-switch__track {
    position: relative;
    flex: none;
    inline-size: 2.75rem;
    block-size: 1.5rem;
    border-radius: 0.75rem;
    background-color: rgba(255, 255, 255, 0.1);
    border: 1px solid var(--c-border-strong);
    transition:
        background-color var(--duration-fade) ease,
        border-color var(--duration-fade) ease,
        box-shadow var(--duration-fade) ease;
}

.admin-switch__thumb {
    position: absolute;
    inset-block-start: 50%;
    inset-inline-start: 0.1875rem;
    inline-size: 1.0625rem;
    block-size: 1.0625rem;
    border-radius: 50%;
    background-color: var(--c-text-muted);
    transform: translateY(-50%);
    transition:
        transform var(--duration-slide) cubic-bezier(0.22, 0.61, 0.36, 1),
        background-color var(--duration-fade) ease;
}

.admin-switch[aria-checked='true'] {
    color: var(--c-text);
}

.admin-switch[aria-checked='true'] .admin-switch__track {
    background-color: color-mix(in srgb, var(--c-accent) 30%, transparent);
    border-color: var(--c-accent);
    box-shadow: 0 0 12px var(--c-accent-glow);
}

.admin-switch[aria-checked='true'] .admin-switch__thumb {
    background-color: var(--c-accent);
    transform: translate(1.25rem, -50%);
}

.admin-switch:disabled {
    cursor: not-allowed;
    opacity: 0.6;
}

.admin-switch__state {
    min-inline-size: 5.5rem;
    text-align: start;
    white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
    .admin-switch__track,
    .admin-switch__thumb {
        transition: none;
    }
}
</style>
