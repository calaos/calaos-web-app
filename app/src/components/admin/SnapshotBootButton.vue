<script setup lang="ts">
// Reboots on one snapshot, after a question: the box goes offline for minutes.

import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAdminSnapshotsStore } from '../../stores/adminSnapshots';
import BaseDialog from '../ui/BaseDialog.vue';
import AppButton from '../ui/AppButton.vue';

const props = defineProps<{ id: number }>();

const { t } = useI18n();
const snapshots = useAdminSnapshotsStore();

const asking = ref(false);

function confirm(): void {
    asking.value = false;
    void snapshots.boot(props.id);
}
</script>

<template>
    <AppButton
        variant="quiet"
        class="snapshot-boot"
        :aria-label="t('admin.snapshots.bootLabel', { id })"
        :disabled="snapshots.busy"
        @click="asking = true"
    >
        {{ t('admin.snapshots.boot') }}
    </AppButton>

    <BaseDialog
        :open="asking"
        :title="t('admin.snapshots.bootDialog.title', { id })"
        :confirm-label="t('admin.snapshots.bootDialog.confirm')"
        :cancel-label="t('dialog.cancel')"
        @confirm="confirm"
        @cancel="asking = false"
    >
        <p class="snapshot-boot__hint">{{ t('admin.snapshots.bootDialog.hint') }}</p>
    </BaseDialog>
</template>

<style scoped>
.snapshot-boot {
    min-block-size: 2.75rem;
}

.snapshot-boot__hint {
    color: var(--c-text-muted);
    font-size: 0.9375rem;
    line-height: 1.45;
}
</style>
