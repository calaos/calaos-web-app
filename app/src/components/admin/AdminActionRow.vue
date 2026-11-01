<script setup lang="ts">
// One action of the box, as a line of a hairline list: what it does on the
// left, its button in the slot.

defineProps<{
    name: string;
    hint: string;
}>();
</script>

<template>
    <li class="action-row">
        <div class="action-row__text">
            <span class="action-row__name">{{ name }}</span>
            <span class="action-row__hint">{{ hint }}</span>
        </div>
        <slot />
    </li>
</template>

<style scoped>
.action-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-2);
    border-block-end: 1px solid var(--c-border);
}

.action-row__text {
    display: grid;
    gap: var(--space-1);
    min-inline-size: 0;
}

.action-row__name {
    font-size: 1rem;
}

.action-row__hint {
    color: var(--c-text-muted);
    font-size: 0.875rem;
    line-height: 1.4;
}

@media (max-width: 479px) {
    .action-row {
        flex-direction: column;
        align-items: stretch;
    }
}
</style>
