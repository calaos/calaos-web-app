<script setup lang="ts">
// A full-panel state the user can only wait on (or leave): an icon, a title,
// one sentence saying what is happening and what to do. Amber for "the box
// is not ready", red for "this will not work", cyan only while working.

import IconAlert from '~icons/mdi/alert-outline';
import IconLoading from '~icons/mdi/loading';
import IconLock from '~icons/mdi/lock-outline';

withDefaults(
    defineProps<{
        title: string;
        hint: string;
        tone?: 'warn' | 'danger' | 'working' | 'secure';
    }>(),
    { tone: 'warn' },
);
</script>

<template>
    <div class="admin-notice fade-in" :class="`admin-notice--${tone}`" role="status" aria-live="polite">
        <span class="admin-notice__icon" aria-hidden="true">
            <IconLoading v-if="tone === 'working'" class="admin-notice__spinner" />
            <IconLock v-else-if="tone === 'secure'" />
            <IconAlert v-else class="pulse-soft" />
        </span>
        <h2 class="admin-notice__title">{{ title }}</h2>
        <p class="admin-notice__hint">{{ hint }}</p>
        <div v-if="$slots.default" class="admin-notice__actions">
            <slot />
        </div>
    </div>
</template>

<style scoped>
.admin-notice {
    display: grid;
    justify-items: start;
    gap: var(--space-2);
}

.admin-notice__icon {
    display: flex;
    font-size: 2rem;
    margin-block-end: var(--space-2);
}

.admin-notice--warn .admin-notice__icon {
    color: var(--c-warn);
}

.admin-notice--danger .admin-notice__icon {
    color: var(--c-danger);
}

.admin-notice--working .admin-notice__icon,
.admin-notice--secure .admin-notice__icon {
    color: var(--c-accent);
}

.admin-notice__spinner {
    animation: admin-notice-spin 900ms linear infinite;
}

@keyframes admin-notice-spin {
    to {
        transform: rotate(360deg);
    }
}

.admin-notice__title {
    font-size: 1.375rem;
    font-weight: 400;
    letter-spacing: var(--tracking-tight);
    line-height: 1.2;
}

.admin-notice__hint {
    color: var(--c-text-muted);
    font-size: 0.9375rem;
    line-height: 1.45;
    max-inline-size: 36ch;
}

.admin-notice__actions {
    margin-block-start: var(--space-4);
}

@media (prefers-reduced-motion: reduce) {
    .admin-notice__spinner {
        animation: none;
    }
}
</style>
