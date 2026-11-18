<script setup lang="ts">
// A table when the container is wide enough, cards otherwise. Both are in the
// DOM and only the visible one is exposed to assistive technology.

import { useI18n } from 'vue-i18n';
import type { Snapshot } from '../../protocol/admin-snapshots';
import { useAdminDates } from '../../composables/useAdminDates';
import SnapshotBootButton from './SnapshotBootButton.vue';

defineProps<{
    snapshots: Snapshot[];
    /** An admin session is open: the boot buttons exist at all. */
    canAct: boolean;
}>();

const { t } = useI18n();
const { dayTime } = useAdminDates();

function dateOf(snapshot: Snapshot): string {
    const text = snapshot.date === '' ? '' : dayTime(snapshot.date);
    return text === '' ? t('admin.snapshots.noDate') : text;
}

function descriptionOf(snapshot: Snapshot): string {
    return snapshot.description === '' ? t('admin.snapshots.noDescription') : snapshot.description;
}

function canBoot(snapshot: Snapshot): boolean {
    return snapshot.bootable && !snapshot.current;
}
</script>

<template>
    <div class="snaps">
        <table class="snaps__table">
            <thead>
                <tr>
                    <th scope="col">{{ t('admin.snapshots.columns.id') }}</th>
                    <th scope="col">{{ t('admin.snapshots.columns.date') }}</th>
                    <th scope="col">{{ t('admin.snapshots.columns.type') }}</th>
                    <th scope="col">{{ t('admin.snapshots.columns.description') }}</th>
                    <th v-if="canAct" scope="col">{{ t('admin.snapshots.columns.action') }}</th>
                </tr>
            </thead>
            <tbody>
                <tr
                    v-for="snapshot in snapshots"
                    :key="snapshot.id"
                    :class="{ 'snaps__row--current': snapshot.current }"
                    :data-snapshot="snapshot.id"
                >
                    <td class="snaps__id">#{{ snapshot.id }}</td>
                    <td>{{ dateOf(snapshot) }}</td>
                    <td>
                        <span class="snaps__badges">
                            <span v-if="snapshot.current" class="snaps__badge snaps__badge--current">{{ t('admin.snapshots.badge.current') }}</span>
                            <span v-if="snapshot.default" class="snaps__badge snaps__badge--default">{{ t('admin.snapshots.badge.default') }}</span>
                            <span v-if="!snapshot.bootable && !snapshot.current" class="snaps__badge snaps__badge--no">{{ t('admin.snapshots.badge.notBootable') }}</span>
                            <span v-if="snapshot.type !== ''" class="snaps__badge">{{ t(`admin.snapshots.type.${snapshot.type}`) }}</span>
                        </span>
                    </td>
                    <td class="snaps__desc">{{ descriptionOf(snapshot) }}</td>
                    <td v-if="canAct" class="snaps__act">
                        <SnapshotBootButton v-if="canBoot(snapshot)" :id="snapshot.id" />
                    </td>
                </tr>
            </tbody>
        </table>

        <ul class="snaps__cards">
            <li
                v-for="snapshot in snapshots"
                :key="snapshot.id"
                class="snaps__card admin-card"
                :class="{ 'snaps__row--current': snapshot.current }"
                :data-snapshot="snapshot.id"
            >
                <div class="snaps__top">
                    <b>#{{ snapshot.id }}</b>
                    <span class="snaps__badges">
                        <span v-if="snapshot.current" class="snaps__badge snaps__badge--current">{{ t('admin.snapshots.badge.current') }}</span>
                        <span v-if="snapshot.default" class="snaps__badge snaps__badge--default">{{ t('admin.snapshots.badge.default') }}</span>
                        <span v-if="!snapshot.bootable && !snapshot.current" class="snaps__badge snaps__badge--no">{{ t('admin.snapshots.badge.notBootable') }}</span>
                        <span v-if="snapshot.type !== ''" class="snaps__badge">{{ t(`admin.snapshots.type.${snapshot.type}`) }}</span>
                    </span>
                </div>
                <p class="snaps__desc">{{ descriptionOf(snapshot) }}</p>
                <p class="snaps__meta">{{ dateOf(snapshot) }}</p>
                <SnapshotBootButton v-if="canAct && canBoot(snapshot)" :id="snapshot.id" />
            </li>
        </ul>
    </div>
</template>

<style scoped>
.snaps {
    container-type: inline-size;
}

.snaps__table {
    display: none;
    inline-size: 100%;
    border-collapse: collapse;
    background-color: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
}

.snaps__table th {
    padding: var(--space-3);
    text-align: start;
    font-size: 0.75rem;
    font-weight: 500;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text-muted);
    border-block-end: 1px solid var(--c-border);
}

.snaps__table td {
    padding: var(--space-3);
    vertical-align: middle;
    border-block-end: 1px solid var(--c-border);
}

.snaps__table tr:last-child td {
    border-block-end: 0;
}

.snaps__id {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.snaps__act {
    text-align: end;
}

.snaps__cards {
    display: grid;
    gap: var(--space-2);
    list-style: none;
}

.snaps__card {
    display: grid;
    gap: var(--space-2);
    justify-items: start;
}

.snaps__top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
}

.snaps__desc {
    overflow-wrap: anywhere;
}

.snaps__meta {
    color: var(--c-text-muted);
    font-size: 0.875rem;
}

.snaps__row--current {
    border-color: var(--c-accent);
    background-color: var(--c-accent-glow);
}

.snaps__badges {
    display: inline-flex;
    flex-wrap: wrap;
    min-inline-size: 0;
    max-inline-size: 100%;
    gap: var(--space-1);
}

.snaps__badge {
    padding: 0.125rem var(--space-2);
    border: 1px solid var(--c-border-strong);
    border-radius: 999px;
    font-size: 0.75rem;
    white-space: nowrap;
    color: var(--c-text-muted);
}

.snaps__badge--current {
    border-color: var(--c-accent);
    color: var(--c-accent);
}

.snaps__badge--default {
    border-color: var(--c-success-border);
}

.snaps__badge--no {
    border-color: var(--c-warn-border);
    color: var(--c-warn);
}

/* The current row is teal: the muted badge text and borders are unreadable on it,
   so its badges sit on the page black with full-strength text. */
.snaps__row--current .snaps__badge {
    background-color: var(--c-bg);
    border-color: var(--c-text);
    color: var(--c-text);
}

.snaps__row--current .snaps__badge--current {
    border-color: var(--c-accent);
    color: var(--c-accent);
}

@container (min-width: 640px) {
    .snaps__table {
        display: table;
    }

    .snaps__cards {
        display: none;
    }
}
</style>
