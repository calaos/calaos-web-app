<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
    <main class="hello">
        <h1 class="hello__title">{{ t('app.name') }}</h1>
        <p class="hello__subtitle">Vue 3 scaffold is alive.</p>
        <button type="button" class="hello__button pressable">Press me</button>
    </main>
</template>

<style scoped>
.hello {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    background: var(--c-bg);
    color: var(--c-text);
    text-align: center;
    padding: var(--space-8);
}

.hello__title {
    font-size: 2.5rem;
    font-weight: 700;
    color: var(--c-accent);
    text-shadow: 0 0 1.5rem var(--c-accent-glow);
}

.hello__subtitle {
    color: var(--c-text-muted);
}

.hello__button {
    margin-top: var(--space-4);
    padding: var(--space-3) var(--space-6);
    border-radius: var(--radius-md);
    border: 1px solid var(--c-accent);
    background: var(--c-surface);
    color: var(--c-text);
    font: inherit;
    font-size: 1rem;
    cursor: pointer;
}

.hello__button:hover {
    background: var(--c-surface-raised);
}
</style>
