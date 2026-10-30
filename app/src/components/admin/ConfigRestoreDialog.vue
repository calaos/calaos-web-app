<script setup lang="ts">
// The last stop before the box's files are replaced. The title comes from the
// file's own manifest; the rest from the box's dry run, as the server read them.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseDialog from '../ui/BaseDialog.vue';
import type { ConfigRestoreResult, RestoreCounts } from '../../protocol/admin-config';
import type { RestoreManifest } from '../../protocol/backup-zip';
import { useAdminDates } from '../../composables/useAdminDates';

const COUNTS: (keyof RestoreCounts)[] = ['rooms', 'ios', 'devices', 'rules'];
/** The manifest is whatever the file says: as long as a hostname label, no more. */
const MAX_TITLE_FIELD_CHARS = 63;

const props = defineProps<{
    /** Open while set. */
    preview: ConfigRestoreResult | null;
    manifest: RestoreManifest | null;
    sending: boolean;
    error: string;
}>();

const downloadFirst = defineModel<boolean>('downloadFirst', { required: true });
const emit = defineEmits<{ confirm: []; cancel: [] }>();

const { t, te } = useI18n();
const { dayTime } = useAdminDates();

function clipped(text: string): string {
    return text.length > MAX_TITLE_FIELD_CHARS ? `${text.slice(0, MAX_TITLE_FIELD_CHARS - 1)}…` : text;
}

const title = computed(() => {
    const manifest = props.manifest;
    const date = manifest !== null ? dayTime(manifest.createdAt) : '';
    if (manifest === null || manifest.hostname === '' || manifest.serverVersion === '' || date === '') {
        return t('admin.config.restoreTitleBare');
    }
    return t('admin.config.restoreTitle', {
        host: clipped(manifest.hostname),
        date,
        version: clipped(manifest.serverVersion),
    });
});

const rows = computed(() => {
    const preview = props.preview;
    if (preview === null) return [];
    return COUNTS.map((key) => ({
        key,
        backup: preview.backup[key],
        box: preview.box[key],
        changes: preview.backup[key] !== preview.box[key],
    }));
});

function warningText(code: string): string {
    const key = `admin.config.restoreWarning.${code}`;
    return te(key) ? t(key) : t('admin.config.restoreWarningUnknown', { code });
}
</script>

<template>
    <BaseDialog
        :open="preview !== null"
        :title="title"
        :confirm-label="sending ? t('admin.config.restoreSending') : t('admin.config.restoreConfirm')"
        :cancel-label="t('dialog.cancel')"
        :confirm-disabled="sending"
        wide
        danger
        @confirm="emit('confirm')"
        @cancel="emit('cancel')"
    >
        <template v-if="preview !== null">
            <table class="restore__counts">
                <caption class="visually-hidden">{{ t('admin.config.restoreCompare') }}</caption>
                <thead>
                    <tr>
                        <td></td>
                        <th scope="col">{{ t('admin.config.restoreBackup') }}</th>
                        <th scope="col">{{ t('admin.config.restoreBox') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="row in rows" :key="row.key" :class="{ 'restore__row--same': !row.changes }">
                        <th scope="row">{{ t(`admin.config.restoreCount.${row.key}`) }}</th>
                        <td>{{ row.backup }}</td>
                        <td>{{ row.box }}</td>
                    </tr>
                </tbody>
            </table>

            <p class="restore__files">{{ t('admin.config.restoreFiles', { files: preview.files.join(', ') }) }}</p>

            <ul v-if="preview.warnings.length > 0" class="restore__warnings">
                <li v-for="code in preview.warnings" :key="code" :data-warning="code">{{ warningText(code) }}</li>
            </ul>

            <p class="restore__kept">{{ t('admin.config.restoreKept') }}</p>

            <label class="restore__first">
                <input v-model="downloadFirst" type="checkbox" :disabled="sending" />
                <span>{{ t('admin.config.restoreDownloadFirst') }}</span>
            </label>

            <p v-if="error !== ''" class="restore__error" role="alert">{{ error }}</p>
        </template>
    </BaseDialog>
</template>

<style scoped>
.restore__counts {
    inline-size: 100%;
    border-collapse: collapse;
    font-size: 0.9375rem;
}

.restore__counts th,
.restore__counts td {
    padding-block: var(--space-2);
    border-block-end: 1px solid var(--c-border);
    text-align: end;
}

.restore__counts thead th {
    color: var(--c-text-muted);
    font-size: 0.875rem;
    font-weight: 400;
}

.restore__counts tbody th {
    color: var(--c-text-muted);
    font-weight: 400;
    text-align: start;
}

.restore__counts tbody td {
    inline-size: 6.5rem;
    color: var(--c-text);
    font-variant-numeric: tabular-nums;
}

/* What does not change steps back, so that the eye lands on what does. */
.restore__row--same td {
    color: var(--c-text-muted);
}

.restore__files {
    margin-block-start: var(--space-3);
    color: var(--c-text-muted);
    font-size: 0.875rem;
    line-height: 1.45;
    overflow-wrap: anywhere;
}

.restore__warnings {
    display: grid;
    gap: var(--space-2);
    margin-block-start: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--c-warn-border);
    border-radius: var(--radius-md);
    background-color: var(--c-warn-bg);
    color: var(--c-warn);
    font-size: 0.9375rem;
    line-height: 1.45;
}

.restore__kept {
    margin-block-start: var(--space-3);
    color: var(--c-text);
    font-size: 0.9375rem;
    line-height: 1.45;
}

.restore__first {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-block-size: 2.75rem;
    color: var(--c-text);
    font-size: 0.9375rem;
    cursor: pointer;
}

.restore__first input {
    flex: none;
    inline-size: 1.25rem;
    block-size: 1.25rem;
    margin: 0;
    accent-color: var(--c-accent);
}

.restore__error {
    color: var(--c-danger-text);
    font-size: 0.875rem;
    line-height: 1.45;
    overflow-wrap: anywhere;
}
</style>
