<script setup lang="ts">
// The admin password's line and dialog. Once a phone is an approver, the new
// password also takes a code from it.

import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseDialog from '../ui/BaseDialog.vue';
import { ADMIN_PASSWORD_MIN_LENGTH } from '../../protocol/admin';
import { useAdminStore } from '../../stores/admin';
import { useApproversStore } from '../../stores/approvers';
import { useAdminText } from '../../composables/useAdminText';
import AdminActionRow from './AdminActionRow.vue';
import AdminButton from './AdminButton.vue';
import AdminPasswordForm from './AdminPasswordForm.vue';
import CodeEntry from './CodeEntry.vue';

const { t } = useI18n();
const admin = useAdminStore();
const approvers = useApproversStore();
const { errorText } = useAdminText();

const changing = ref(false);
const refused = ref(false);

const failure = computed(() =>
    admin.notice !== null && admin.noticeSource === 'box' ? errorText(admin.notice) : '',
);
const changeError = computed(() => {
    if (!changing.value) return '';
    if (approvers.flowError !== null) return errorText(approvers.flowError);
    return failure.value;
});
const hasApprover = computed(() => (approvers.approvers?.length ?? 0) > 0);
/** Known to have none: the change can only fail, so say so before any typing. */
const noApprover = computed(() => approvers.approvers !== null && approvers.approvers.length === 0);
const passwordChallenge = computed(() =>
    approvers.challenge?.step === 'password' ? approvers.challenge : null,
);

function openChange(): void {
    approvers.cancel();
    changing.value = true;
}

function closeChange(): void {
    // Escape during a check would hide a write that still lands.
    if (approvers.working !== null) return;
    approvers.cancel();
    changing.value = false;
}

async function changePassword(password: string): Promise<void> {
    refused.value = false;
    if (hasApprover.value) {
        await approvers.startPasswordChange(password);
        return;
    }
    const ok = await admin.setPassword(password);
    if (ok) {
        changing.value = false;
        return;
    }
    // The gate may have moved (bad_session → the unlock screen replaces this).
    if (admin.gate !== 'unlocked') {
        changing.value = false;
        return;
    }
    // An approver enrolled elsewhere since the list was read.
    if (admin.notice?.code === 'code_required') {
        admin.dismissNotice();
        await approvers.startPasswordChange(password);
        return;
    }
    refused.value = true;
}

function addPhone(): void {
    closeChange();
    approvers.requestAdd();
}

async function submitCode(code: string): Promise<void> {
    await approvers.submit(code);
    if (approvers.done === 'password') {
        approvers.dismissDone();
        changing.value = false;
    }
}
</script>

<template>
    <section class="password" :aria-label="t('admin.actions.password')">
        <ul class="password__list">
            <AdminActionRow
                :name="t('admin.actions.password')"
                :hint="noApprover ? t('admin.actions.passwordNeedsApprover') : t('admin.actions.passwordHint')"
            >
                <AdminButton variant="quiet" :disabled="admin.busy !== null" @click="openChange">
                    {{ t('admin.actions.change') }}
                </AdminButton>
            </AdminActionRow>
        </ul>

        <p v-if="failure !== '' && !changing" class="password__error fade-in" role="alert">{{ failure }}</p>

        <!-- The form has its own submit and cancel; the dialog only lends
             its frame (and Escape). -->
        <BaseDialog :open="changing" :title="t('admin.change.title')" @cancel="closeChange">
            <CodeEntry
                v-if="passwordChallenge !== null"
                :challenge="passwordChallenge"
                :working="approvers.working"
                :alternative="approvers.alternative?.deviceName ?? null"
                @submit="submitCode"
                @resend="approvers.resend()"
                @other="approvers.sendToOther()"
                @cancel="closeChange"
            />
            <template v-if="noApprover && passwordChallenge === null">
                <p class="password__hint">{{ t('admin.actions.passwordNeedsApprover') }}</p>
                <div class="password__buttons">
                    <AdminButton variant="quiet" @click="closeChange">{{ t('dialog.cancel') }}</AdminButton>
                    <AdminButton @click="addPhone">{{ t('admin.approvers.add') }}</AdminButton>
                </div>
            </template>
            <p v-else-if="passwordChallenge === null" class="password__hint password__hint--form">
                {{ t('admin.change.hint', { min: ADMIN_PASSWORD_MIN_LENGTH }) }}
                <template v-if="hasApprover">{{ t('admin.change.codeHint') }}</template>
            </p>
            <AdminPasswordForm
                v-if="passwordChallenge === null && !noApprover"
                mode="change"
                :busy="admin.busy === 'set' || admin.busy === 'unlock' || approvers.working === 'sending'"
                :error="changeError"
                :refused="refused"
                :cancel-label="t('dialog.cancel')"
                @submit="changePassword"
                @cancel="closeChange"
            />
        </BaseDialog>
    </section>
</template>

<style scoped>
.password__list {
    border-block-start: 1px solid var(--c-border);
}

.password__error {
    margin-block-start: var(--space-3);
    padding-inline: var(--space-2);
    color: var(--c-danger-text);
    font-size: 0.875rem;
}

.password__hint {
    color: var(--c-text-muted);
    font-size: 0.9375rem;
    line-height: 1.45;
}

.password__hint--form {
    margin-block-end: var(--space-4);
}

.password__buttons {
    display: flex;
    gap: var(--space-3);
    margin-block-start: var(--space-6);
}

.password__buttons > * {
    flex: 1;
}
</style>
