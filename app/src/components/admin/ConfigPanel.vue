<script setup lang="ts">
// calaos_server's own settings, folded by default, and the configuration
// backup. The registry validates every value; its refusal is shown under the
// row it concerns. The backup is an HTTP download: the session rides in the
// POST body, never a URL.

import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import IconChevron from '~icons/mdi/chevron-down';
import BaseDialog from '../ui/BaseDialog.vue';
import { SELF_SERVICE_ID } from '../../protocol/admin-services';
import type { ConfigOption } from '../../protocol/admin-config';
import { useAdminStore } from '../../stores/admin';
import { useAdminConfigStore } from '../../stores/adminConfig';
import { useAdminServicesStore } from '../../stores/adminServices';
import { useAdminText } from '../../composables/useAdminText';
import { groupOptions } from './configEditors';
import AdminButton from './AdminButton.vue';
import AdminField from './AdminField.vue';
import ConfigRow from './ConfigRow.vue';

const SAVED_FLASH_MS = 2_500;

const { t, te } = useI18n();
const admin = useAdminStore();
const config = useAdminConfigStore();
const services = useAdminServicesStore();
const { errorText } = useAdminText();

const open = ref(false);
const loading = ref(false);
const saving = ref<string | null>(null);
const savedKey = ref<string | null>(null);
const rowErrors = ref<Record<string, string>>({});
let savedTimer: ReturnType<typeof setTimeout> | undefined;

const busy = computed(() => admin.busy !== null);
const groups = computed(() => groupOptions(config.options ?? []));
const loadError = computed(() => (config.error !== null ? errorText(config.error) : ''));

function groupLabel(group: string): string {
    const key = `admin.config.group.${group}`;
    return te(key) ? t(key) : group;
}

async function load(): Promise<void> {
    loading.value = true;
    await config.load();
    loading.value = false;
}

function toggle(): void {
    open.value = !open.value;
    if (open.value && config.options === null && !loading.value) void load();
}

async function save(key: string, value: string): Promise<void> {
    saving.value = key;
    savedKey.value = null;
    const { error } = await config.set(key, value);
    saving.value = null;
    const errors = { ...rowErrors.value };
    if (error !== null) {
        errors[key] = errorText(error);
    } else {
        delete errors[key];
        savedKey.value = key;
        clearTimeout(savedTimer);
        savedTimer = setTimeout(() => (savedKey.value = null), SAVED_FLASH_MS);
    }
    rowErrors.value = errors;
}

// ---- secrets: written, never read back ----------------------------------

const secretFor = ref<ConfigOption | null>(null);
const secretDraft = ref('');

function openSecret(option: ConfigOption): void {
    secretDraft.value = '';
    secretFor.value = option;
}

function closeSecret(): void {
    secretFor.value = null;
    secretDraft.value = '';
}

function confirmSecret(): void {
    const option = secretFor.value;
    const value = secretDraft.value;
    closeSecret();
    if (option !== null) void save(option.key, value);
}

// ---- restart ------------------------------------------------------------

const restarting = ref(false);
const restartError = ref('');

async function restartServer(): Promise<void> {
    restartError.value = '';
    const { outcome, error } = await services.restart(SELF_SERVICE_ID);
    if (outcome === 'failed') {
        restartError.value = error !== null ? errorText(error) : '';
        return;
    }
    restarting.value = true;
    config.dismissRestart();
}

// ---- backup -------------------------------------------------------------

const confirmingBackup = ref(false);
const downloading = ref(false);
const backupError = ref('');
const backupName = ref('');

async function downloadBackup(): Promise<void> {
    confirmingBackup.value = false;
    downloading.value = true;
    backupError.value = '';
    backupName.value = '';
    const outcome = await config.downloadBackup();
    downloading.value = false;
    if (!('blob' in outcome)) {
        backupError.value = errorText(outcome);
        return;
    }
    const url = URL.createObjectURL(outcome.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = outcome.filename;
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Revoking at once can cancel the save in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    backupName.value = outcome.filename;
}
</script>

<template>
    <section class="config" aria-labelledby="config-title">
        <p id="config-title" class="config__eyebrow">{{ t('admin.config.title') }}</p>

        <div v-if="config.restartRequired || restarting" class="config__restart fade-in" role="status">
            <template v-if="restarting">
                <p class="config__restart-text">{{ t('admin.config.restarting') }}</p>
            </template>
            <template v-else>
                <div class="config__restart-text">
                    <strong class="config__restart-title">{{ t('admin.config.restartRequired') }}</strong>
                    <span>{{ t('admin.config.restartHint') }}</span>
                    <span v-if="restartError !== ''" class="config__restart-error" role="alert">{{ restartError }}</span>
                </div>
                <div class="config__restart-actions">
                    <AdminButton
                        variant="primary"
                        :busy="admin.busy === 'services_restart'"
                        :disabled="busy"
                        @click="restartServer"
                    >
                        {{ t('admin.config.restartNow') }}
                    </AdminButton>
                    <AdminButton variant="quiet" :disabled="busy" @click="config.dismissRestart()">
                        {{ t('admin.config.later') }}
                    </AdminButton>
                </div>
            </template>
        </div>

        <ul class="config__list">
            <li class="config__row">
                <div class="config__text">
                    <span class="config__name">{{ t('admin.config.backup') }}</span>
                    <span class="config__hint">{{ t('admin.config.backupHint') }}</span>
                </div>
                <AdminButton
                    variant="quiet"
                    :busy="downloading"
                    :busy-label="t('admin.config.backupDownloading')"
                    :disabled="busy"
                    @click="confirmingBackup = true"
                >
                    {{ t('admin.config.backupConfirm') }}
                </AdminButton>
                <p v-if="backupError !== ''" class="config__row-note config__row-note--error fade-in" role="alert">
                    {{ backupError }}
                </p>
                <p v-else-if="backupName !== ''" class="config__row-note fade-in" role="status">
                    {{ t('admin.config.backupDone', { name: backupName }) }}
                </p>
            </li>

            <li class="config__row config__row--toggle">
                <button
                    type="button"
                    class="config__toggle"
                    :aria-expanded="open"
                    aria-controls="config-options"
                    @click="toggle"
                >
                    <span class="config__text">
                        <span class="config__name">{{ open ? t('admin.config.hide') : t('admin.config.show') }}</span>
                        <span class="config__hint">{{ t('admin.config.hint') }}</span>
                    </span>
                    <IconChevron class="config__chevron" :class="{ 'config__chevron--open': open }" aria-hidden="true" />
                </button>
            </li>
        </ul>

        <div v-if="open" id="config-options" class="config__options">
            <p v-if="loading && config.options === null" class="config__status" role="status">
                {{ t('admin.config.loading') }}
            </p>
            <div v-else-if="config.options === null" class="config__status config__status--error" role="alert">
                <span>{{ t('admin.config.loadFailed') }} {{ loadError }}</span>
                <AdminButton variant="quiet" :disabled="busy" @click="load">{{ t('admin.config.retry') }}</AdminButton>
            </div>

            <section
                v-for="entry in groups"
                :key="entry.group"
                class="config__group"
                :aria-labelledby="`config-group-${entry.group}`"
            >
                <h3 :id="`config-group-${entry.group}`" class="config__group-title">{{ groupLabel(entry.group) }}</h3>
                <ul class="config__group-list">
                    <ConfigRow
                        v-for="option in entry.options"
                        :key="option.key"
                        :data-key="option.key"
                        :option="option"
                        :disabled="busy"
                        :saving="saving === option.key"
                        :saved="savedKey === option.key"
                        :error="rowErrors[option.key] ?? ''"
                        @save="(value) => save(option.key, value)"
                        @secret="openSecret(option)"
                    />
                </ul>
            </section>
        </div>

        <BaseDialog
            :open="secretFor !== null"
            :eyebrow="secretFor?.key ?? ''"
            :title="t('admin.config.secretTitle')"
            :confirm-label="t('admin.config.secretConfirm')"
            :cancel-label="t('dialog.cancel')"
            @confirm="confirmSecret"
            @cancel="closeSecret"
        >
            <AdminField
                v-model="secretDraft"
                :label="t('admin.config.secretLabel')"
                type="password"
                autocomplete="new-password"
                autofocus
                described-by="config-secret-hint"
            />
            <p id="config-secret-hint" class="config__dialog-hint">{{ t('admin.config.secretHint') }}</p>
        </BaseDialog>

        <BaseDialog
            :open="confirmingBackup"
            :title="t('admin.config.backupConfirmTitle')"
            :confirm-label="t('admin.config.backupConfirm')"
            :cancel-label="t('dialog.cancel')"
            @confirm="downloadBackup"
            @cancel="confirmingBackup = false"
        >
            <p class="config__warning">{{ t('admin.config.backupWarning') }}</p>
        </BaseDialog>
    </section>
</template>

<style scoped>
.config__eyebrow {
    padding-inline: var(--space-2);
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text-muted);
}

/* The one loud thing here: amber, the colour of "act on the box". */
.config__restart {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3) var(--space-4);
    margin-block-start: var(--space-2);
    padding: var(--space-4);
    border: 1px solid rgba(224, 163, 86, 0.4);
    border-inline-start: 3px solid var(--c-warn);
    border-radius: var(--radius-md);
    background-color: rgba(52, 38, 20, 0.6);
    font-size: 0.875rem;
    line-height: 1.4;
    color: var(--c-text-muted);
}

.config__restart-text {
    display: grid;
    gap: var(--space-1);
    min-inline-size: 0;
    flex: 1 1 16rem;
}

.config__restart-title {
    color: var(--c-warn);
    font-size: 0.9375rem;
    font-weight: 500;
}

.config__restart-error {
    color: var(--c-danger-text);
}

.config__restart-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
}

.config__list {
    margin-block-start: var(--space-2);
    border-block-start: 1px solid var(--c-border);
}

.config__row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3) var(--space-4);
    padding: var(--space-4) var(--space-2);
    border-block-end: 1px solid var(--c-border);
}

.config__row--toggle {
    padding: 0;
}

.config__text {
    display: grid;
    gap: var(--space-1);
    min-inline-size: 0;
    flex: 1 1 14rem;
    text-align: start;
}

.config__name {
    font-size: 1rem;
    color: var(--c-text);
}

.config__hint {
    color: var(--c-text-muted);
    font-size: 0.875rem;
    line-height: 1.4;
}

.config__row-note {
    flex-basis: 100%;
    color: var(--c-success);
    font-size: 0.875rem;
    overflow-wrap: anywhere;
}

.config__row-note--error {
    color: var(--c-danger-text);
}

.config__toggle {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    inline-size: 100%;
    min-block-size: 2.75rem;
    padding: var(--space-4) var(--space-2);
    border: 0;
    background: none;
    font: inherit;
    cursor: pointer;
}

.config__toggle:hover .config__name {
    color: var(--c-accent);
}

.config__chevron {
    flex: none;
    font-size: 1.5rem;
    color: var(--c-text-muted);
    transition: transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

.config__chevron--open {
    transform: rotate(180deg);
}

.config__options {
    display: grid;
    gap: var(--space-6);
    margin-block-start: var(--space-4);
}

.config__status {
    padding-inline: var(--space-2);
    color: var(--c-text-muted);
    font-size: 0.9375rem;
}

.config__status--error {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    color: var(--c-danger-text);
}

.config__group-title {
    padding-inline: var(--space-2);
    padding-block-end: var(--space-2);
    border-block-end: 1px solid var(--c-border-strong);
    font-size: 1.0625rem;
    font-weight: 500;
    letter-spacing: var(--tracking-tight);
    color: var(--c-text);
}

.config__dialog-hint {
    margin-block-start: var(--space-3);
    color: var(--c-text-muted);
    font-size: 0.875rem;
    line-height: 1.45;
}

.config__warning {
    padding: var(--space-3) var(--space-4);
    border: 1px solid rgba(224, 163, 86, 0.4);
    border-radius: var(--radius-md);
    background-color: rgba(52, 38, 20, 0.6);
    color: var(--c-warn);
    font-size: 0.9375rem;
    line-height: 1.45;
}

@media (max-width: 479px) {
    .config__restart-actions > * {
        flex: 1 1 100%;
    }
}

@media (prefers-reduced-motion: reduce) {
    .config__chevron {
        transition: none;
    }
}
</style>
