<script setup lang="ts">
// What the box has to say after an action. Shown on the page the action ran
// on, and it stays in the store for the hub if that page is left unread.

import { useI18n } from 'vue-i18n';
import { useAdminStore } from '../../stores/admin';

withDefaults(defineProps<{ dismissible?: boolean }>(), { dismissible: true });

const { t } = useI18n();
const admin = useAdminStore();
</script>

<template>
    <p v-if="admin.info !== null" class="admin__info fade-in" role="status">
        <span>{{ t(`admin.info.${admin.info}`) }}</span>
        <button v-if="dismissible" type="button" class="admin__dismiss" @click="admin.dismissInfo()">
            {{ t('admin.dismiss') }}
        </button>
    </p>
</template>

<style scoped>
.admin__info {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--c-success-border);
    border-radius: var(--radius-md);
    background-color: color-mix(in srgb, var(--c-success) 10%, var(--c-surface));
    color: var(--c-success);
    font-size: 0.9375rem;
    line-height: 1.4;
}

.admin__dismiss {
    flex: none;
    padding: var(--space-1) var(--space-3);
    border: 1px solid currentColor;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
}
</style>
