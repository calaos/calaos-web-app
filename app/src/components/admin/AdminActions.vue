<script setup lang="ts">
// The three things an unlocked admin can do to the box besides updating it,
// as a hairline list. The two that cannot be undone (restart, new MCP token)
// ask once. Once a phone is an approver, the new password also takes a code
// from it.

import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseDialog from '../ui/BaseDialog.vue';
import { ADMIN_PASSWORD_MIN_LENGTH } from '../../protocol/admin';
import { useAdminStore } from '../../stores/admin';
import { useApproversStore } from '../../stores/approvers';
import { useAdminText } from '../../composables/useAdminText';
import AdminButton from './AdminButton.vue';
import AdminPasswordForm from './AdminPasswordForm.vue';
import CodeEntry from './CodeEntry.vue';

const { t } = useI18n();
const admin = useAdminStore();
const approvers = useApproversStore();
const { errorText } = useAdminText();

const confirming = ref<'reboot' | 'mcp' | null>(null);
const changing = ref(false);
const refused = ref(false);

const busy = computed(() => admin.busy !== null);
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

/** Also reached from the updates panel's "Restart the box". */
function askReboot(): void {
    confirming.value = 'reboot';
}

defineExpose({ askReboot });

const emit = defineEmits<{ addPhone: [] }>();

function confirm(): void {
    const what = confirming.value;
    confirming.value = null;
    if (what === 'reboot') void admin.reboot();
    if (what === 'mcp') void admin.regenerateMcp();
}

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
    emit('addPhone');
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
    <section class="actions" aria-labelledby="actions-title">
        <p id="actions-title" class="actions__eyebrow">{{ t('admin.actions.title') }}</p>

        <ul class="actions__list">
            <li class="actions__row">
                <div class="actions__text">
                    <span class="actions__name">{{ t('admin.actions.password') }}</span>
                    <span class="actions__hint">
                        {{ noApprover ? t('admin.actions.passwordNeedsApprover') : t('admin.actions.passwordHint') }}
                    </span>
                </div>
                <AdminButton variant="quiet" :disabled="busy" @click="openChange">
                    {{ t('admin.actions.change') }}
                </AdminButton>
            </li>

            <li class="actions__row">
                <div class="actions__text">
                    <span class="actions__name">{{ t('admin.actions.reboot') }}</span>
                    <span class="actions__hint">{{ t('admin.actions.rebootHint') }}</span>
                </div>
                <AdminButton
                    variant="quiet"
                    :disabled="busy || admin.isUpgrading"
                    :busy="admin.busy === 'system_reboot'"
                    @click="confirming = 'reboot'"
                >
                    {{ t('admin.actions.rebootConfirm') }}
                </AdminButton>
            </li>

            <li class="actions__row">
                <div class="actions__text">
                    <span class="actions__name">{{ t('admin.actions.mcp') }}</span>
                    <span class="actions__hint">{{ t('admin.actions.mcpHint') }}</span>
                </div>
                <AdminButton
                    variant="quiet"
                    :disabled="busy"
                    :busy="admin.busy === 'mcp_regenerate'"
                    @click="confirming = 'mcp'"
                >
                    {{ t('admin.actions.regenerate') }}
                </AdminButton>
            </li>
        </ul>

        <p v-if="failure !== '' && !changing" class="actions__error fade-in" role="alert">{{ failure }}</p>

        <BaseDialog
            :open="confirming === 'reboot'"
            :title="t('admin.actions.rebootConfirmTitle')"
            :confirm-label="t('admin.actions.rebootConfirm')"
            :cancel-label="t('dialog.cancel')"
            @confirm="confirm"
            @cancel="confirming = null"
        >
            <p class="actions__dialog-hint">{{ t('admin.actions.rebootConfirmHint') }}</p>
        </BaseDialog>

        <BaseDialog
            :open="confirming === 'mcp'"
            :title="t('admin.actions.mcpConfirmTitle')"
            :confirm-label="t('admin.actions.mcpConfirm')"
            :cancel-label="t('dialog.cancel')"
            @confirm="confirm"
            @cancel="confirming = null"
        >
            <p class="actions__dialog-hint">{{ t('admin.actions.mcpConfirmHint') }}</p>
        </BaseDialog>

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
                <p class="actions__dialog-hint">{{ t('admin.actions.passwordNeedsApprover') }}</p>
                <div class="actions__dialog-buttons">
                    <AdminButton variant="quiet" @click="closeChange">{{ t('dialog.cancel') }}</AdminButton>
                    <AdminButton @click="addPhone">{{ t('admin.approvers.add') }}</AdminButton>
                </div>
            </template>
            <p v-else-if="passwordChallenge === null" class="actions__dialog-hint actions__dialog-hint--form">
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
.actions__eyebrow {
    padding-inline: var(--space-2);
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text-muted);
}

.actions__list {
    margin-block-start: var(--space-2);
    border-block-start: 1px solid var(--c-border);
}

.actions__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-2);
    border-block-end: 1px solid var(--c-border);
}

.actions__text {
    display: grid;
    gap: var(--space-1);
    min-inline-size: 0;
}

.actions__name {
    font-size: 1rem;
}

.actions__hint {
    color: var(--c-text-muted);
    font-size: 0.875rem;
    line-height: 1.4;
}

.actions__error {
    margin-block-start: var(--space-3);
    padding-inline: var(--space-2);
    color: var(--c-danger-text);
    font-size: 0.875rem;
}

.actions__dialog-hint {
    color: var(--c-text-muted);
    font-size: 0.9375rem;
    line-height: 1.45;
}

.actions__dialog-buttons {
    display: flex;
    gap: var(--space-3);
    margin-block-start: var(--space-6);
}

.actions__dialog-buttons > * {
    flex: 1;
}

.actions__dialog-hint--form {
    margin-block-end: var(--space-4);
}

@media (max-width: 479px) {
    .actions__row {
        flex-direction: column;
        align-items: stretch;
    }
}
</style>
