<script setup lang="ts">
// The box's network interfaces, and a change applied as a trial that the
// user keeps, from the new address if it moved. The way in is a warning,
// then a code from an approver phone; the way out is the countdown panel.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import type { AdminError } from '../protocol/admin';
import type { NetInterface, NetworkChange } from '../protocol/admin-network';
import { useAdminStore } from '../stores/admin';
import { useAdminNetworkStore } from '../stores/adminNetwork';
import { useApproversStore } from '../stores/approvers';
import { useAdminText } from '../composables/useAdminText';
import BaseDialog from '../components/ui/BaseDialog.vue';
import AdminButton from '../components/admin/AdminButton.vue';
import AdminNotice from '../components/admin/AdminNotice.vue';
import AdminPageHeader from '../components/admin/AdminPageHeader.vue';
import CodeEntry from '../components/admin/CodeEntry.vue';
import NetworkForm from '../components/admin/NetworkForm.vue';
import NetworkPending from '../components/admin/NetworkPending.vue';

const KNOWN_STATES: Record<string, string> = {
    routable: 'routable',
    degraded: 'degraded',
    carrier: 'carrier',
    'no-carrier': 'noCarrier',
    off: 'off',
};

const { t } = useI18n();
const router = useRouter();
const admin = useAdminStore();
const network = useAdminNetworkStore();
const approvers = useApproversStore();
const { errorText } = useAdminText();

const editing = ref<string | null>(null);
/** The change waiting behind the warning, then behind the code. */
const proposed = ref<NetworkChange | null>(null);
const step = ref<'warn' | 'code' | null>(null);
/** A refusal that closed the code step (another change got there first). */
const refusal = ref<AdminError | null>(null);

const interfaces = computed(() => (network.interfaces ?? []).filter((intf) => intf.name !== 'lo'));
const trial = computed(() => network.pending !== null || network.lostApply !== null);
const noApprover = computed(() => approvers.approvers !== null && approvers.approvers.length === 0);
const challenge = computed(() => (approvers.challenge?.step === 'network' ? approvers.challenge : null));
const codeError = computed(() => (approvers.flowError === null ? '' : errorText(approvers.flowError)));

// A rollback is told by the app-wide alert banner, which also outlives a
// reload; repeating it here would say the same thing twice.
const outcome = computed(() => {
    const done = network.finished;
    if (done === null) return null;
    return {
        tone: done.state === 'confirmed' ? 'ok' : 'neutral',
        text: t(`admin.network.done.${done.state}`, { intf: done.intf }),
    };
});

function stateText(intf: NetInterface): string {
    const key = KNOWN_STATES[intf.state];
    return key === undefined ? t('admin.network.state.other', { state: intf.state }) : t(`admin.network.state.${key}`);
}

function stateTone(intf: NetInterface): string {
    if (intf.state === 'routable') return 'up';
    if (intf.state === 'degraded' || intf.state === 'carrier') return 'partial';
    return 'down';
}

function listText(values: string[]): string {
    return values.length === 0 ? t('admin.network.field.none') : values.join(', ');
}

function dismissOutcome(): void {
    network.dismissFinished();
}

function edit(name: string): void {
    refusal.value = null;
    editing.value = name;
}

function propose(change: NetworkChange): void {
    proposed.value = change;
    step.value = 'warn';
}

async function sendCode(): Promise<void> {
    const change = proposed.value;
    if (change === null) return;
    step.value = 'code';
    await network.startApply(change);
}

function closeCode(): void {
    // Escape during a check would hide an apply that still lands.
    if (approvers.working !== null) return;
    approvers.cancel();
    step.value = null;
}

function addPhone(): void {
    approvers.cancel();
    step.value = null;
    void router.push({ name: 'admin', query: { add: 'phone' } });
}

watch(
    () => approvers.done,
    (done) => {
        if (done !== 'network') return;
        approvers.dismissDone();
        step.value = null;
        editing.value = null;
        proposed.value = null;
    },
);

// The box already has a change on trial: the code stays unspent, and the
// waiting change is what to look at now.
watch(
    () => challenge.value?.error,
    (error) => {
        if (error?.code !== 'network_pending') return;
        approvers.cancel();
        refusal.value = error;
        step.value = null;
        editing.value = null;
    },
);

watch(
    () => admin.isUnlocked,
    (unlocked) => {
        if (!unlocked) void router.replace({ name: 'admin' });
    },
);

onMounted(() => {
    if (!admin.isUnlocked) {
        void router.replace({ name: 'admin' });
        return;
    }
    void network.load();
    if (approvers.approvers === null) void approvers.load();
});

onBeforeUnmount(() => {
    if (step.value !== null) approvers.cancel();
});
</script>

<template>
    <div class="network">
        <div class="network__page">
            <AdminPageHeader :title="t('admin.network.title')" :hint="t('admin.network.hint')" />

            <p
                v-if="outcome !== null"
                class="network__outcome fade-in"
                :class="`network__outcome--${outcome.tone}`"
                role="status"
            >
                <span>{{ outcome.text }}</span>
                <button type="button" class="network__dismiss" @click="dismissOutcome">
                    {{ t('admin.network.done.dismiss') }}
                </button>
            </p>

            <p v-if="refusal !== null" class="network__refusal fade-in" role="alert">{{ errorText(refusal) }}</p>

            <NetworkPending v-if="trial" />

            <AdminNotice
                v-if="network.interfaces === null && network.error === null"
                tone="working"
                :title="t('admin.network.loading')"
                hint=""
            />

            <AdminNotice
                v-else-if="network.interfaces === null && network.error !== null"
                tone="warn"
                :title="t('admin.network.title')"
                :hint="errorText(network.error)"
            >
                <AdminButton @click="network.load()">{{ t('admin.network.retry') }}</AdminButton>
            </AdminNotice>

            <p v-else-if="interfaces.length === 0" class="network__empty">{{ t('admin.network.empty') }}</p>

            <ul v-else class="network__list">
                <li
                    v-for="intf in interfaces"
                    :key="intf.name"
                    class="network__intf"
                    :class="{ 'network__intf--editing': editing === intf.name }"
                >
                    <div class="network__intf-head">
                        <div class="network__intf-name">
                            <h2 class="network__name">{{ intf.name }}</h2>
                            <span class="network__state" :class="`network__state--${stateTone(intf)}`">
                                {{ stateText(intf) }}
                            </span>
                        </div>
                        <AdminButton
                            v-if="editing !== intf.name"
                            variant="quiet"
                            :disabled="trial || editing !== null"
                            :aria-label="`${t('admin.network.edit')} ${intf.name}`"
                            @click="edit(intf.name)"
                        >
                            {{ t('admin.network.edit') }}
                        </AdminButton>
                    </div>

                    <dl class="network__facts">
                        <div class="network__fact">
                            <dt>{{ t('admin.network.field.settings') }}</dt>
                            <dd>{{ intf.dhcp ? t('admin.network.dhcp') : t('admin.network.static') }}</dd>
                        </div>
                        <div class="network__fact">
                            <dt>{{ t('admin.network.field.address') }}</dt>
                            <dd class="network__value">{{ intf.ipv4 || t('admin.network.field.none') }}</dd>
                        </div>
                        <div class="network__fact">
                            <dt>{{ t('admin.network.field.gateway') }}</dt>
                            <dd class="network__value">{{ intf.gateway || t('admin.network.field.none') }}</dd>
                        </div>
                        <div class="network__fact">
                            <dt>{{ t('admin.network.field.dns') }}</dt>
                            <dd class="network__value">{{ listText(intf.dnsServers) }}</dd>
                        </div>
                        <div class="network__fact">
                            <dt>{{ t('admin.network.field.domains') }}</dt>
                            <dd class="network__value">{{ listText(intf.searchDomains) }}</dd>
                        </div>
                        <div class="network__fact">
                            <dt>{{ t('admin.network.field.mac') }}</dt>
                            <dd class="network__value">{{ intf.mac }}</dd>
                        </div>
                    </dl>

                    <template v-if="editing === intf.name">
                        <h3 class="network__form-title">{{ t('admin.network.form.title', { intf: intf.name }) }}</h3>
                        <div v-if="noApprover" class="network__needs">
                            <p>{{ t('admin.network.form.needsApprover') }}</p>
                            <div class="network__needs-actions">
                                <AdminButton variant="quiet" @click="editing = null">
                                    {{ t('admin.network.form.cancel') }}
                                </AdminButton>
                                <AdminButton @click="addPhone">{{ t('admin.approvers.add') }}</AdminButton>
                            </div>
                        </div>
                        <template v-else>
                            <p v-if="trial" class="network__busy">{{ t('admin.network.form.busy') }}</p>
                            <NetworkForm
                                :intf="intf"
                                :disabled="trial || step !== null"
                                @apply="propose"
                                @cancel="editing = null"
                            />
                        </template>
                    </template>
                </li>
            </ul>
        </div>

        <BaseDialog
            :open="step === 'warn'"
            :title="t('admin.network.warn.title')"
            :confirm-label="t('admin.network.warn.confirm')"
            :cancel-label="t('dialog.cancel')"
            @confirm="sendCode"
            @cancel="step = null"
        >
            <p class="network__dialog-hint">{{ t('admin.network.warn.hint') }}</p>
        </BaseDialog>

        <BaseDialog
            :open="step === 'code'"
            :title="t('admin.network.form.title', { intf: proposed?.intf ?? '' })"
            @cancel="closeCode"
        >
            <CodeEntry
                v-if="challenge !== null"
                :challenge="challenge"
                :working="approvers.working"
                :alternative="approvers.alternative?.deviceName ?? null"
                @submit="approvers.submit"
                @resend="approvers.resend()"
                @other="approvers.sendToOther()"
                @cancel="closeCode"
            />
            <template v-else-if="codeError !== ''">
                <p class="network__dialog-hint network__dialog-hint--error" role="alert">{{ codeError }}</p>
                <div class="network__needs-actions">
                    <AdminButton variant="quiet" @click="closeCode">{{ t('dialog.cancel') }}</AdminButton>
                    <AdminButton v-if="approvers.flowError?.code === 'approver_required'" @click="addPhone">
                        {{ t('admin.approvers.add') }}
                    </AdminButton>
                </div>
            </template>
            <p v-else class="network__dialog-hint" role="status">{{ t('admin.code.sending') }}</p>
        </BaseDialog>
    </div>
</template>

<style scoped>
.network {
    padding: var(--space-4);
}

@media (min-width: 480px) {
    .network {
        padding: var(--space-6);
    }
}

.network__page {
    display: grid;
    gap: var(--space-6);
    inline-size: 100%;
    max-inline-size: 40rem;
    margin-inline: auto;
}

.network__outcome {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--radius-md);
    font-size: 0.9375rem;
    line-height: 1.4;
}

.network__outcome--ok {
    border-color: rgba(76, 175, 125, 0.35);
    background-color: rgba(76, 175, 125, 0.1);
    color: var(--c-success);
}

.network__dismiss {
    flex: none;
    min-block-size: 32px;
    padding: var(--space-1) var(--space-3);
    border: 1px solid currentColor;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
}

.network__dismiss:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
}

.network__refusal,
.network__dialog-hint--error {
    color: var(--c-danger-text);
    font-size: 0.9375rem;
    line-height: 1.45;
}

.network__empty {
    color: var(--c-text-muted);
}

/* The interfaces as a hairline list, like the box's actions: the countdown
   panel above is the only raised surface on the page. */
.network__list {
    border-block-start: 1px solid var(--c-border);
}

.network__intf {
    padding: var(--space-4) var(--space-2);
    border-block-end: 1px solid var(--c-border);
}

.network__intf--editing {
    padding-inline: var(--space-4);
    border-radius: var(--radius-md);
    background-color: rgba(255, 255, 255, 0.03);
}

.network__intf-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
}

.network__intf-name {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-3);
    min-inline-size: 0;
}

.network__name {
    font-size: 1.125rem;
    font-weight: 500;
    overflow-wrap: anywhere;
}

.network__state {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--c-text-muted);
    font-size: 0.875rem;
}

.network__state::before {
    content: '';
    inline-size: 0.5rem;
    block-size: 0.5rem;
    border-radius: 50%;
    background-color: var(--c-track);
}

.network__state--up::before {
    background-color: var(--c-success);
    box-shadow: 0 0 8px rgba(76, 175, 125, 0.6);
}

.network__state--partial::before {
    background-color: var(--c-warn);
}

.network__facts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
    gap: var(--space-3) var(--space-6);
    margin-block-start: var(--space-4);
}

.network__fact {
    display: grid;
    gap: 0.125rem;
    align-content: start;
    min-inline-size: 0;
    line-height: 1.4;
}

.network__fact dt {
    color: var(--c-text-muted);
    font-size: 0.8125rem;
}

.network__fact dd {
    margin: 0;
    font-size: 0.9375rem;
}

.network__value {
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
}

.network__form-title {
    margin-block-start: var(--space-6);
    font-size: 1rem;
    font-weight: 500;
}

.network__busy {
    margin-block-start: var(--space-2);
    color: var(--c-warn);
    font-size: 0.875rem;
}

.network__needs {
    display: grid;
    gap: var(--space-4);
    margin-block-start: var(--space-3);
    color: var(--c-text-muted);
    font-size: 0.9375rem;
    line-height: 1.45;
}

.network__needs-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-3);
    margin-block-start: var(--space-4);
}

.network__dialog-hint {
    color: var(--c-text-muted);
    font-size: 0.9375rem;
    line-height: 1.45;
}

@media (max-width: 479px) {
    .network__facts {
        grid-template-columns: 1fr 1fr;
        column-gap: var(--space-4);
    }

    .network__needs-actions > * {
        flex: 1 1 100%;
    }
}
</style>
