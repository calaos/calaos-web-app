<script setup lang="ts">
// The three things an unlocked admin can do to the box besides updating it,
// as a hairline list — the room screen's rows, not cards. Each is a name, one
// sentence, and a button that says what it does. The two that cannot be
// undone (restart, new MCP token) ask once.

import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseDialog from '../ui/BaseDialog.vue';
import { useAdminStore } from '../../stores/admin';
import { useAdminText } from '../../composables/useAdminText';
import AdminButton from './AdminButton.vue';
import AdminPasswordForm from './AdminPasswordForm.vue';

const { t } = useI18n();
const admin = useAdminStore();
const { errorText } = useAdminText();

const confirming = ref<'reboot' | 'mcp' | null>(null);
const changing = ref(false);
const refused = ref(false);

const busy = computed(() => admin.busy !== null);
const failure = computed(() => (admin.notice === null ? '' : errorText(admin.notice)));
const changeError = computed(() => (changing.value ? failure.value : ''));

/** Also reached from the updates panel's "Restart the box". */
function askReboot(): void {
    confirming.value = 'reboot';
}

defineExpose({ askReboot });

function confirm(): void {
    const what = confirming.value;
    confirming.value = null;
    if (what === 'reboot') void admin.reboot();
    if (what === 'mcp') void admin.regenerateMcp();
}

async function changePassword(password: string): Promise<void> {
    refused.value = false;
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
    refused.value = true;
}
</script>

<template>
    <section class="actions" aria-labelledby="actions-title">
        <p id="actions-title" class="actions__eyebrow">{{ t('admin.actions.title') }}</p>

        <ul class="actions__list">
            <li class="actions__row">
                <div class="actions__text">
                    <span class="actions__name">{{ t('admin.actions.password') }}</span>
                    <span class="actions__hint">{{ t('admin.actions.passwordHint') }}</span>
                </div>
                <AdminButton variant="quiet" :disabled="busy" @click="changing = true">
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

        <!-- The form has its own submit; the dialog only lends its frame and
             its Cancel, so no confirm-label here. -->
        <BaseDialog
            :open="changing"
            :title="t('admin.change.title')"
            :cancel-label="t('dialog.cancel')"
            @cancel="changing = false"
        >
            <AdminPasswordForm
                mode="change"
                :busy="admin.busy === 'set' || admin.busy === 'unlock'"
                :error="changeError"
                :refused="refused"
                @submit="changePassword"
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
    color: var(--c-danger);
    font-size: 0.875rem;
}

.actions__dialog-hint {
    color: var(--c-text-muted);
    font-size: 0.9375rem;
    line-height: 1.45;
}

@media (max-width: 479px) {
    .actions__row {
        flex-direction: column;
        align-items: stretch;
    }
}
</style>
