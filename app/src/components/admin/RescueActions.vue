<script setup lang="ts">
// What the admin can do while the box runs on a snapshot: make it permanent,
// or go back to the normal system (a plain reboot).

import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import IconWarn from '~icons/mdi/alert-outline';
import { useAdminSnapshotsStore } from '../../stores/adminSnapshots';
import { useRescueStore } from '../../stores/rescue';
import BaseDialog from '../ui/BaseDialog.vue';
import AppButton from '../ui/AppButton.vue';
import RollbackDialog from './RollbackDialog.vue';

const { t } = useI18n();
const snapshots = useAdminSnapshotsStore();
const rescue = useRescueStore();

const asking = ref<'rollback' | 'normal' | null>(null);

function rollback(): void {
    asking.value = null;
    void snapshots.rollback();
}

function normal(): void {
    asking.value = null;
    void snapshots.returnNormal();
}
</script>

<template>
    <section class="rescue admin-card" aria-labelledby="rescue-title">
        <h2 id="rescue-title" class="rescue__title">
            <IconWarn aria-hidden="true" />
            {{ t('admin.snapshots.rescue.title') }}
        </h2>
        <p class="rescue__hint">{{ t('admin.snapshots.rescue.hint') }}</p>
        <div class="rescue__actions">
            <AppButton variant="danger" :disabled="snapshots.busy" @click="asking = 'rollback'">
                {{ t('admin.snapshots.rescue.rollback') }}
            </AppButton>
            <AppButton variant="quiet" :disabled="snapshots.busy" @click="asking = 'normal'">
                {{ t('admin.snapshots.rescue.normal') }}
            </AppButton>
        </div>
    </section>

    <RollbackDialog
        :open="asking === 'rollback'"
        :snapshot="rescue.snapshot"
        @confirm="rollback"
        @cancel="asking = null"
    />

    <BaseDialog
        :open="asking === 'normal'"
        :title="t('admin.snapshots.normalDialog.title')"
        :confirm-label="t('admin.snapshots.normalDialog.confirm')"
        :cancel-label="t('dialog.cancel')"
        @confirm="normal"
        @cancel="asking = null"
    >
        <p class="rescue__hint">{{ t('admin.snapshots.normalDialog.hint') }}</p>
    </BaseDialog>
</template>

<style scoped>
.rescue {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
    border-color: var(--c-warn-border);
    background-color: var(--c-warn-bg);
}

.rescue__title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--c-warn);
    font-size: 1.125rem;
    font-weight: 500;
}

.rescue__hint {
    color: var(--c-text-muted);
    font-size: 0.9375rem;
    line-height: 1.45;
}

.rescue__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
}
</style>
