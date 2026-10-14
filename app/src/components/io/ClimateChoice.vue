<script setup lang="ts">
// One row of a choice list: what it is called, and a tick when it is the
// current one. A list of these is a radio group.

import IconCheck from '~icons/mdi/check';

defineProps<{
    label: string;
    selected: boolean;
}>();

defineEmits<{ choose: [] }>();
</script>

<template>
    <button
        type="button"
        class="climate-choice"
        :class="{ 'climate-choice--on': selected }"
        role="radio"
        :aria-checked="selected"
        @click="$emit('choose')"
    >
        <span class="climate-choice__lead" aria-hidden="true"><slot name="icon" /></span>
        <span class="climate-choice__label">{{ label }}</span>
        <IconCheck v-if="selected" class="climate-choice__tick" aria-hidden="true" />
    </button>
</template>

<style scoped>
.climate-choice {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    inline-size: 100%;
    block-size: 2.75rem;
    padding: 0 0.625rem;
    font-size: 0.9375rem;
    text-align: start;
    color: var(--c-text);
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
}

.climate-choice:hover:not(.climate-choice--on) {
    background: var(--c-surface-raised);
}

.climate-choice--on {
    color: var(--c-accent);
    background: rgba(56, 176, 211, 0.12);
}

.climate-choice__lead {
    display: inline-grid;
    place-items: center;
    font-size: 1.25rem;
    color: var(--c-text-muted);
}

/* No icon, no gap: the swing and fan values start flush left. */
.climate-choice__lead:empty {
    display: none;
}

.climate-choice--on .climate-choice__lead {
    color: var(--c-accent);
}

.climate-choice__label {
    flex: 1;
}

.climate-choice__tick {
    font-size: 1.25rem;
}
</style>
