<script setup lang="ts">
// Title of an Admin sub-page, under the trail back to the Admin hub.

import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import IconChevron from '~icons/mdi/chevron-right';

defineProps<{
    title: string;
    hint?: string;
}>();

const { t } = useI18n();
</script>

<template>
    <header class="page-head fade-in-down">
        <nav :aria-label="t('admin.pages.trail')">
            <ol class="page-head__trail">
                <li>
                    <RouterLink class="page-head__up" :to="{ name: 'admin' }">{{ t('admin.title') }}</RouterLink>
                </li>
                <li class="page-head__here" aria-current="page">
                    <IconChevron class="page-head__sep" aria-hidden="true" />
                    <span>{{ title }}</span>
                </li>
            </ol>
        </nav>
        <h1 class="page-head__title">{{ title }}</h1>
        <p v-if="hint" class="page-head__hint">{{ hint }}</p>
    </header>
</template>

<style scoped>
.page-head__trail {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 0.875rem;
    color: var(--c-text);
}

.page-head__here {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
}

.page-head__sep {
    font-size: 1rem;
}

.page-head__up {
    color: var(--c-text);
    text-decoration: underline;
    border-radius: var(--radius-sm);
}

.page-head__up:hover {
    text-decoration: underline;
}

.page-head__up:focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 2px;
}

.page-head__title {
    margin-block-start: var(--space-2);
    font-size: clamp(1.5rem, 6vw, 1.875rem);
    font-weight: 400;
    letter-spacing: var(--tracking-tight);
    line-height: 1.15;
}

.page-head__hint {
    margin-block-start: var(--space-2);
    color: var(--c-text);
    font-size: 0.9375rem;
    line-height: 1.45;
    max-inline-size: 52ch;
}
</style>
