<script setup lang="ts">
// The way into the logs page, as one row in the actions' hairline dress.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAdminStore } from '../../stores/admin';
import AdminButton from './AdminButton.vue';

const { t } = useI18n();
const router = useRouter();
const admin = useAdminStore();

const busy = computed(() => admin.busy !== null);
</script>

<template>
    <section class="logs-entry" :aria-label="t('admin.logs.title')">
        <div class="logs-entry__row">
            <div class="logs-entry__text">
                <span class="logs-entry__name">{{ t('admin.logs.title') }}</span>
                <span class="logs-entry__hint">{{ t('admin.logs.openHint') }}</span>
            </div>
            <AdminButton variant="quiet" :disabled="busy" @click="router.push({ name: 'adminLogs' })">
                {{ t('admin.logs.open') }}
            </AdminButton>
        </div>
    </section>
</template>

<style scoped>
.logs-entry__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-2);
    border-block: 1px solid var(--c-border);
}

.logs-entry__text {
    display: grid;
    gap: var(--space-1);
    min-inline-size: 0;
}

.logs-entry__name {
    font-size: 1rem;
}

.logs-entry__hint {
    color: var(--c-text-muted);
    font-size: 0.875rem;
    line-height: 1.4;
}

@media (max-width: 479px) {
    .logs-entry__row {
        flex-direction: column;
        align-items: stretch;
    }
}
</style>
