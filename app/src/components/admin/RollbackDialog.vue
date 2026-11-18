<script setup lang="ts">
// Rollback is permanent: the checkbox must be ticked again on every opening,
// and Cancel takes the focus so that a stray Enter cannot confirm.

import { ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseDialog from '../ui/BaseDialog.vue';

const props = defineProps<{ open: boolean; snapshot: number | null }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();

const { t } = useI18n();
const checked = ref(false);
const checkId = useId();

watch(
    () => props.open,
    () => {
        checked.value = false;
    },
);
</script>

<template>
    <BaseDialog
        :open="open"
        danger
        focus-cancel
        :title="
            snapshot === null
                ? t('admin.snapshots.rollbackDialog.titleUnknown')
                : t('admin.snapshots.rollbackDialog.title', { id: snapshot })
        "
        :confirm-label="t('admin.snapshots.rollbackDialog.confirm')"
        :cancel-label="t('dialog.cancel')"
        :confirm-disabled="!checked"
        @confirm="emit('confirm')"
        @cancel="emit('cancel')"
    >
        <p class="rollback__hint">{{ t('admin.snapshots.rollbackDialog.hint') }}</p>
        <label :for="checkId" class="rollback__check">
            <input :id="checkId" v-model="checked" type="checkbox" />
            <span>{{ t('admin.snapshots.rollbackDialog.check') }}</span>
        </label>
    </BaseDialog>
</template>

<style scoped>
.rollback__hint {
    color: var(--c-text-muted);
    font-size: 0.9375rem;
    line-height: 1.45;
}

.rollback__check {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-block-size: 2.75rem;
    margin-block-start: var(--space-4);
    cursor: pointer;
}

.rollback__check input {
    inline-size: 1.25rem;
    block-size: 1.25rem;
    accent-color: var(--c-danger);
}
</style>
