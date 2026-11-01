<script setup lang="ts">
// The phones that receive admin codes, as the same hairline list as the box
// actions. Adding and removing run in one dialog that ends on the code
// entry; the dialog title stays the job ("Add a phone"), the body says which
// code is awaited.

import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import IconAndroid from '~icons/mdi/android';
import IconApple from '~icons/mdi/apple';
import IconCellphone from '~icons/mdi/cellphone';
import IconCheckCircle from '~icons/mdi/check-circle';
import IconLock from '~icons/mdi/lock';
import IconLockOpenVariant from '~icons/mdi/lock-open-variant';
import { APPROVER_MAX } from '../../protocol/admin';
import type { Approver, ApproverCandidate } from '../../protocol/admin';
import { useAdminStore } from '../../stores/admin';
import { useApproversStore } from '../../stores/approvers';
import { useAdminDates } from '../../composables/useAdminDates';
import { useAdminText } from '../../composables/useAdminText';
import BaseDialog from '../ui/BaseDialog.vue';
import AdminButton from './AdminButton.vue';
import CodeEntry from './CodeEntry.vue';
import DeviceName from './DeviceName.vue';
import { isolateName } from '../../composables/isolateName';

/** Ahead of the 30-day purge of push tokens, so the warning comes in time. */
const STALE_AFTER_MS = 25 * 86_400_000;

const { t } = useI18n();
const admin = useAdminStore();
const approvers = useApproversStore();
const { day, ago } = useAdminDates();
const { errorText } = useAdminText();

const mode = ref<'add' | 'remove' | null>(null);
const picked = ref<string | null>(null);
const removing = ref<Approver | null>(null);

onMounted(() => {
    void approvers.load();
});

const list = computed(() => approvers.approvers ?? []);
const full = computed(() => list.value.length >= APPROVER_MAX);
const busy = computed(() => admin.busy !== null || approvers.working !== null);

/** Two phones of the same name are told apart by the end of their token id. */
function suffixNeeded(name: string, among: { deviceName: string }[]): boolean {
    return among.filter((entry) => entry.deviceName === name).length > 1;
}

function platformLabel(platform: string): string {
    return ['ios', 'android', 'desktop'].includes(platform)
        ? t(`admin.approvers.platform.${platform}`)
        : t('admin.approvers.platform.other');
}

function iconFor(platform: string): typeof IconCellphone {
    if (platform === 'ios') return IconApple;
    if (platform === 'android') return IconAndroid;
    return IconCellphone;
}

function freshness(lastSeen: string): 'gone' | 'stale' | 'ok' {
    const time = Date.parse(lastSeen);
    if (!Number.isFinite(time)) return 'gone';
    return Date.now() - time > STALE_AFTER_MS ? 'stale' : 'ok';
}

const dialogTitle = computed(() => {
    if (mode.value === 'remove' && removing.value !== null) {
        return t('admin.approvers.removeTitle', { name: isolateName(removing.value.deviceName) });
    }
    return t('admin.approvers.pick.title');
});

const lastRefused = computed(() => approvers.flowError?.code === 'approver_last');
const flowErrorText = computed(() =>
    approvers.flowError === null || lastRefused.value ? '' : errorText(approvers.flowError),
);

const selectable = computed(() => (approvers.candidates ?? []).filter((c) => !c.approver));
const pickedCandidate = computed<ApproverCandidate | undefined>(() =>
    approvers.candidates?.find((c) => c.tokenId === picked.value),
);

function openAdd(): void {
    approvers.cancel();
    approvers.dismissDone();
    picked.value = null;
    mode.value = 'add';
    void approvers.loadCandidates().then(() => {
        if (selectable.value.length === 1) picked.value = selectable.value[0].tokenId;
    });
}

function openRemove(approver: Approver): void {
    approvers.cancel();
    approvers.dismissDone();
    removing.value = approver;
    mode.value = 'remove';
    if (list.value.length === 1) approvers.refuseLast();
}

watch(
    () => approvers.addAsked,
    () => openAdd(),
);

/** Escape during a check would hide a write that still lands. */
function close(): void {
    if (approvers.working !== null) return;
    mode.value = null;
    removing.value = null;
    approvers.cancel();
}

function sendFirstCode(): void {
    if (mode.value === 'add' && pickedCandidate.value !== undefined) {
        void approvers.startEnrolment(pickedCandidate.value);
    } else if (mode.value === 'remove' && removing.value !== null) {
        void approvers.startRemoval(removing.value);
    }
}

async function submitCode(code: string): Promise<void> {
    await approvers.submit(code);
    if (approvers.done !== null) close();
}
</script>

<template>
    <section class="approvers" aria-labelledby="approvers-title">
        <p id="approvers-title" class="approvers__eyebrow">{{ t('admin.approvers.title') }}</p>
        <p class="approvers__intro">{{ t('admin.approvers.intro') }}</p>

        <p v-if="approvers.done === 'enrolled' || approvers.done === 'removed'" class="approvers__done fade-in" role="status">
            <span>{{ t(`admin.approvers.${approvers.done}`) }}</span>
            <button type="button" class="approvers__dismiss" @click="approvers.dismissDone()">
                {{ t('admin.dismiss') }}
            </button>
        </p>

        <ul class="approvers__list admin-list">
            <li v-if="approvers.listError !== null" class="approvers__row admin-card">
                <div class="approvers__text">
                    <span class="approvers__name">{{ t('admin.approvers.loadFailed') }}</span>
                    <span class="approvers__meta">{{ errorText(approvers.listError) }}</span>
                </div>
                <AdminButton variant="quiet" :disabled="busy" @click="approvers.load()">
                    {{ t('admin.approvers.retry') }}
                </AdminButton>
            </li>

            <li v-else-if="approvers.approvers !== null && list.length === 0" class="approvers__row admin-card approvers__row--empty">
                <div class="approvers__text">
                    <span class="approvers__name">{{ t('admin.approvers.none') }}</span>
                    <span class="approvers__meta">{{ t('admin.approvers.noneHint') }}</span>
                </div>
            </li>

            <li v-for="approver in list" :key="approver.id" class="approvers__row admin-card">
                <component :is="iconFor(approver.platform)" class="approvers__icon" aria-hidden="true" />
                <div class="approvers__text">
                    <span class="approvers__name">
                        <DeviceName :name="approver.deviceName" />
                        <span class="approvers__ref">
                            {{ t('admin.approvers.reference', { suffix: approver.tokenId.slice(-4) }) }}
                        </span>
                    </span>
                    <span class="approvers__meta">
                        {{ platformLabel(approver.platform) }}.
                        {{ t('admin.approvers.added', { date: day(approver.createdAt) }) }}
                    </span>
                    <!-- A purged token reads secure=false, yet no code reaches it at all: updating the app is not the fix. -->
                    <template v-if="freshness(approver.lastSeen) !== 'gone'">
                        <span class="approvers__badge" :class="{ 'approvers__badge--plain': !approver.secure }">
                            <component :is="approver.secure ? IconLock : IconLockOpenVariant" aria-hidden="true" />
                            {{ t(approver.secure ? 'admin.approvers.secure.on' : 'admin.approvers.secure.off') }}
                        </span>
                        <span v-if="!approver.secure" class="approvers__meta">{{ t('admin.approvers.secure.hint') }}</span>
                    </template>
                    <span v-if="freshness(approver.lastSeen) === 'ok'" class="approvers__meta">
                        {{ t('admin.approvers.lastSeen', { when: ago(approver.lastSeen) }) }}
                    </span>
                    <span v-else class="approvers__meta approvers__meta--warn">
                        {{ t(`admin.approvers.${freshness(approver.lastSeen)}`) }}
                    </span>
                </div>
                <AdminButton variant="quiet" :disabled="busy" @click="openRemove(approver)">
                    {{ t('admin.approvers.remove') }}
                </AdminButton>
            </li>
        </ul>

        <div v-if="approvers.approvers !== null" class="approvers__footer">
            <p v-if="full" class="approvers__meta">{{ t('admin.approvers.max') }}</p>
            <AdminButton v-else variant="quiet" :disabled="busy" @click="openAdd">
                {{ t('admin.approvers.add') }}
            </AdminButton>
        </div>

        <BaseDialog :open="mode !== null" :title="dialogTitle" @cancel="close">
            <CodeEntry
                v-if="approvers.challenge !== null"
                :challenge="approvers.challenge"
                :working="approvers.working"
                @submit="submitCode"
                :alternative="approvers.alternative?.deviceName ?? null"
                @resend="approvers.resend()"
                @other="approvers.sendToOther()"
                @cancel="close"
            />

            <!-- The last phone: why not, and the two ways forward. -->
            <div v-else-if="lastRefused" class="approvers__last">
                <p class="approvers__last-title">{{ t('admin.approvers.last.title') }}</p>
                <p class="approvers__dialog-hint">{{ t('admin.approvers.last.body') }}</p>
                <p class="approvers__dialog-hint">{{ t('admin.approvers.last.lost') }}</p>
                <AdminButton class="approvers__dialog-button" block @click="close">
                    {{ t('admin.dismiss') }}
                </AdminButton>
            </div>

            <template v-else-if="mode === 'remove'">
                <p class="approvers__dialog-hint">{{ t('admin.approvers.removeHint') }}</p>
                <p v-if="flowErrorText !== ''" class="approvers__error" role="alert">{{ flowErrorText }}</p>
                <div class="approvers__dialog-actions">
                    <AdminButton variant="quiet" :disabled="busy" @click="close">{{ t('dialog.cancel') }}</AdminButton>
                    <AdminButton
                        variant="danger"
                        :busy="approvers.working === 'sending'"
                        :busy-label="t('admin.code.sending')"
                        :disabled="busy"
                        @click="sendFirstCode"
                    >
                        {{ t('admin.approvers.removeConfirm') }}
                    </AdminButton>
                </div>
            </template>

            <template v-else-if="mode === 'add'">
                <p class="approvers__dialog-hint">{{ t('admin.approvers.pick.hint') }}</p>
                <p v-if="approvers.candidates === null && approvers.flowError === null" class="approvers__dialog-hint">
                    {{ t('admin.approvers.pick.loading') }}
                </p>
                <p
                    v-else-if="approvers.candidates !== null && selectable.length === 0"
                    class="approvers__empty"
                >
                    {{ t('admin.approvers.pick.empty') }}
                </p>
                <fieldset v-else-if="approvers.candidates !== null" class="approvers__choices">
                    <legend class="visually-hidden">{{ t('admin.approvers.pick.title') }}</legend>
                    <label
                        v-for="candidate in approvers.candidates"
                        :key="candidate.tokenId"
                        class="approvers__choice"
                        :class="{
                            'approvers__choice--on': picked === candidate.tokenId,
                            'approvers__choice--off': candidate.approver,
                        }"
                    >
                        <input
                            v-model="picked"
                            class="approvers__radio"
                            type="radio"
                            name="approver-candidate"
                            :value="candidate.tokenId"
                            :disabled="candidate.approver || busy"
                        />
                        <component :is="iconFor(candidate.platform)" class="approvers__icon" aria-hidden="true" />
                        <span class="approvers__text approvers__text--grow">
                            <span class="approvers__name">
                                <DeviceName :name="candidate.deviceName" />
                                <span
                                    v-if="suffixNeeded(candidate.deviceName, approvers.candidates)"
                                    class="approvers__ref"
                                >
                                    {{ t('admin.approvers.reference', { suffix: candidate.tokenId.slice(-4) }) }}
                                </span>
                            </span>
                            <span class="approvers__meta">
                                {{ platformLabel(candidate.platform) }}.
                                {{ t('admin.approvers.registered', { date: day(candidate.registeredAt) }) }}
                            </span>
                            <span class="approvers__badge" :class="{ 'approvers__badge--plain': !candidate.secure }">
                                <component :is="candidate.secure ? IconLock : IconLockOpenVariant" aria-hidden="true" />
                                {{ t(candidate.secure ? 'admin.approvers.secure.on' : 'admin.approvers.secure.off') }}
                            </span>
                            <span v-if="!candidate.secure" class="approvers__meta">{{ t('admin.approvers.secure.hint') }}</span>
                            <span class="approvers__meta">
                                <template v-if="candidate.approver">{{ t('admin.approvers.pick.already') }}</template>
                                <template v-else>{{ t('admin.approvers.lastSeen', { when: ago(candidate.lastSeen) }) }}</template>
                            </span>
                        </span>
                        <IconCheckCircle
                            v-if="picked === candidate.tokenId"
                            class="approvers__check"
                            aria-hidden="true"
                        />
                    </label>
                </fieldset>
                <p v-if="list.length > 0 && selectable.length > 0" class="approvers__dialog-hint approvers__second">
                    {{ t('admin.approvers.pick.secondHint') }}
                </p>
                <p v-if="flowErrorText !== ''" class="approvers__error" role="alert">{{ flowErrorText }}</p>
                <div class="approvers__dialog-actions">
                    <AdminButton variant="quiet" :disabled="busy" @click="close">{{ t('dialog.cancel') }}</AdminButton>
                    <AdminButton
                        :busy="approvers.working === 'sending'"
                        :busy-label="t('admin.code.sending')"
                        :disabled="busy || pickedCandidate === undefined"
                        @click="sendFirstCode"
                    >
                        {{ t('admin.approvers.pick.next') }}
                    </AdminButton>
                </div>
            </template>
        </BaseDialog>
    </section>
</template>

<style scoped>
.approvers__eyebrow {
    padding-inline: var(--space-2);
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text);
}

.approvers__intro {
    margin-block-start: var(--space-2);
    padding-inline: var(--space-2);
    color: var(--c-text);
    font-size: 0.875rem;
    line-height: 1.45;
    max-inline-size: 34rem;
}

.approvers__done {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-block-start: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid rgba(76, 175, 125, 0.35);
    border-radius: var(--radius-md);
    background-color: rgba(76, 175, 125, 0.1);
    color: var(--c-success);
    font-size: 0.9375rem;
}

.approvers__dismiss {
    flex: none;
    padding: var(--space-1) var(--space-3);
    border: 1px solid currentColor;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
}

.approvers__list {
    margin-block-start: var(--space-3);
}

.approvers__row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
}

.approvers__row > .approvers__text {
    flex: 1;
}

.approvers__icon {
    flex: none;
    align-self: flex-start;
    margin-block-start: 0.125rem;
    inline-size: 1.5rem;
    block-size: 1.5rem;
    color: var(--c-text-muted);
}

.approvers__text {
    display: grid;
    gap: var(--space-1);
    min-inline-size: 0;
}

.approvers__name {
    font-size: 1rem;
    overflow-wrap: anywhere;
}

.approvers__ref {
    margin-inline-start: var(--space-2);
    color: var(--c-text-muted);
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
}

.approvers__meta {
    color: var(--c-text-muted);
    font-size: 0.875rem;
    line-height: 1.4;
}

.approvers__badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    justify-self: start;
    color: var(--c-success);
    font-size: 0.8125rem;
}

.approvers__badge svg {
    inline-size: 1rem;
    block-size: 1rem;
}

.approvers__badge--plain {
    color: var(--c-warn);
}

.approvers__meta--warn {
    color: var(--c-warn);
}

.approvers__footer {
    display: flex;
    justify-content: flex-end;
    padding: var(--space-3) var(--space-2) 0;
}

.approvers__dialog-hint {
    color: var(--c-text-muted);
    font-size: 0.9375rem;
    line-height: 1.45;
}

.approvers__dialog-hint + .approvers__dialog-hint {
    margin-block-start: var(--space-3);
}

.approvers__second {
    margin-block-start: var(--space-4);
}

.approvers__empty {
    margin-block-start: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border: 1px solid rgba(224, 163, 86, 0.35);
    border-radius: var(--radius-md);
    background-color: rgba(52, 38, 20, 0.6);
    color: var(--c-text-muted);
    font-size: 0.875rem;
    line-height: 1.45;
}

.approvers__choices {
    display: grid;
    gap: var(--space-2);
    margin: var(--space-4) 0 0;
    padding: 0;
    border: none;
}

.approvers__choice {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: var(--radius-md);
    background-color: rgba(255, 255, 255, 0.04);
    cursor: pointer;
    transition: border-color 200ms ease, background-color 200ms ease;
}

.approvers__choice--on {
    border-color: rgba(56, 176, 211, 0.75);
    background-color: rgba(56, 176, 211, 0.08);
}

.approvers__choice--off {
    opacity: 0.55;
    cursor: default;
}

.approvers__choice:has(:focus-visible) {
    outline: 2px solid var(--c-accent);
    outline-offset: 2px;
}

.approvers__text--grow {
    flex: 1;
}

.approvers__check {
    flex: none;
    inline-size: 1.375rem;
    block-size: 1.375rem;
    color: var(--c-accent);
}

.approvers__radio {
    position: absolute;
    opacity: 0;
    pointer-events: none;
}

.approvers__last-title {
    margin-block-end: var(--space-3);
    color: var(--c-warn);
    font-size: 1rem;
}

.approvers__error {
    margin-block-start: var(--space-3);
    color: var(--c-danger-text);
    font-size: 0.875rem;
    line-height: 1.4;
}

.approvers__dialog-actions {
    display: flex;
    flex-wrap: wrap-reverse;
    gap: var(--space-3);
    margin-block-start: var(--space-6);
}

.approvers__dialog-actions > * {
    flex: 1 1 auto;
}

.approvers__dialog-button {
    margin-block-start: var(--space-6);
}

@media (max-width: 479px) {
    .approvers__row {
        flex-wrap: wrap;
    }

    .approvers__row > :last-child:not(.approvers__text),
    .approvers__footer > * {
        flex-basis: 100%;
    }

    .approvers__dismiss {
        min-block-size: 44px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .approvers__choice {
        transition: none;
    }
}
</style>
