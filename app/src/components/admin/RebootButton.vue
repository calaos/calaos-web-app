<script setup lang="ts">
// The one way to restart the box: the updates page and the system page both
// end on this button and its question.

import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAdminStore } from '../../stores/admin';
import BaseDialog from '../ui/BaseDialog.vue';
import AdminButton from './AdminButton.vue';

withDefaults(
    defineProps<{
        label: string;
        variant?: 'primary' | 'quiet';
        disabled?: boolean;
    }>(),
    { variant: 'quiet', disabled: false },
);

const { t } = useI18n();
const admin = useAdminStore();

const asking = ref(false);

function confirm(): void {
    asking.value = false;
    void admin.reboot();
}
</script>

<template>
    <AdminButton
        :variant="variant"
        :disabled="disabled"
        :busy="admin.busy === 'system_reboot'"
        @click="asking = true"
    >
        {{ label }}
    </AdminButton>

    <BaseDialog
        :open="asking"
        :title="t('admin.actions.rebootConfirmTitle')"
        :confirm-label="t('admin.actions.rebootConfirm')"
        :cancel-label="t('dialog.cancel')"
        @confirm="confirm"
        @cancel="asking = false"
    >
        <p class="reboot__hint">{{ t('admin.actions.rebootConfirmHint') }}</p>
    </BaseDialog>
</template>

<style scoped>
.reboot__hint {
    color: var(--c-text-muted);
    font-size: 0.9375rem;
    line-height: 1.45;
}
</style>
