<script setup lang="ts">
// The box itself: a shell on it, and restarting it.

import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAdminStore } from '../../stores/admin';
import { useApproversStore } from '../../stores/approvers';
import { useAdminText } from '../../composables/useAdminText';
import AdminActionRow from './AdminActionRow.vue';
import AdminButton from './AdminButton.vue';
import RebootButton from './RebootButton.vue';

const { t } = useI18n();
const router = useRouter();
const admin = useAdminStore();
const approvers = useApproversStore();
const { errorText } = useAdminText();

const busy = computed(() => admin.busy !== null);
const failure = computed(() =>
    admin.notice !== null && admin.noticeSource === 'box' ? errorText(admin.notice) : '',
);
/** Known to have none: the console's code has nowhere to go. */
const noApprover = computed(() => approvers.approvers !== null && approvers.approvers.length === 0);

onMounted(() => {
    void approvers.load();
});
</script>

<template>
    <section class="system" :aria-label="t('admin.system.title')">
        <ul class="system__list admin-list">
            <AdminActionRow
                :name="t('admin.actions.console')"
                :hint="noApprover ? t('admin.actions.consoleNeedsApprover') : t('admin.actions.consoleHint')"
            >
                <AdminButton variant="quiet" :disabled="busy" @click="router.push({ name: 'adminConsole' })">
                    {{ t('admin.actions.consoleOpen') }}
                </AdminButton>
            </AdminActionRow>

            <AdminActionRow :name="t('admin.actions.reboot')" :hint="t('admin.actions.rebootHint')">
                <RebootButton :label="t('admin.actions.rebootConfirm')" :disabled="busy || admin.isUpgrading" />
            </AdminActionRow>
        </ul>

        <p v-if="failure !== ''" class="system__error fade-in" role="alert">{{ failure }}</p>
    </section>
</template>

<style scoped>
.system__error {
    margin-block-start: var(--space-3);
    padding-inline: var(--space-2);
    color: var(--c-danger-text);
    font-size: 0.875rem;
}
</style>
