<script setup lang="ts">
// The snapshot list and what can be done with it. A refusal or an unreadable
// list stays here: it says nothing about the rest of the Admin page. A reboot
// whose outcome is unknown is shown as waiting, never as a failure.

import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import IconLoading from '~icons/mdi/loading';
import { useAdminStore } from '../../stores/admin';
import { useAdminSnapshotsStore } from '../../stores/adminSnapshots';
import { useRescueStore } from '../../stores/rescue';
import { useAdminText } from '../../composables/useAdminText';
import AdminNotice from './AdminNotice.vue';
import AppButton from '../ui/AppButton.vue';
import RescueActions from './RescueActions.vue';
import SnapshotList from './SnapshotList.vue';

type Problem = 'unreachable' | 'tooOld' | 'snapper' | 'upgrading' | 'failed';

const { t } = useI18n();
const admin = useAdminStore();
const snapshots = useAdminSnapshotsStore();
const rescue = useRescueStore();
const { errorText } = useAdminText();

const problem = computed<Problem | null>(() => {
    const error = snapshots.error;
    if (error === null) return null;
    switch (error.code) {
        case 'admin_unavailable':
        case 'daemon_unreachable':
            return 'unreachable';
        case 'daemon_too_old':
            return 'tooOld';
        case 'rescue_unavailable':
            return 'snapper';
        case 'upgrade_in_progress':
            return 'upgrading';
        default:
            return 'failed';
    }
});

const canRetry = computed(() => problem.value !== 'tooOld');
const rows = computed(() => snapshots.list?.snapshots ?? []);
const waiting = computed(() => snapshots.phase === 'rebooting');
const dimmed = computed(() => problem.value === 'upgrading' || admin.isUpgrading);

onMounted(() => {
    void snapshots.load();
});
</script>

<template>
    <section class="snap-panel" :aria-label="t('admin.snapshots.title')">
        <AdminNotice
            v-if="waiting && !snapshots.outcomeUnknown"
            tone="working"
            :title="t('admin.snapshots.state.rebooting.title')"
            :hint="t('admin.snapshots.state.rebooting.hint')"
        />
        <AdminNotice
            v-else-if="snapshots.outcomeUnknown"
            tone="working"
            :title="t('admin.snapshots.state.unknown.title')"
            :hint="t('admin.snapshots.state.unknown.hint')"
        />

        <div v-if="snapshots.actionError !== null" class="admin-card admin-card--error snap-panel__refused" role="alert">
            <div>
                <b>{{ t('admin.snapshots.state.refused.title') }}</b>
                <p>{{ errorText(snapshots.actionError) }}</p>
            </div>
            <AppButton variant="quiet" @click="snapshots.dismissActionError()">{{ t('admin.snapshots.dismiss') }}</AppButton>
        </div>

        <RescueActions v-if="rescue.active && admin.isUnlocked && !waiting" />

        <p v-if="snapshots.list === null && problem === null" class="snap-panel__loading" role="status">
            <IconLoading class="snap-panel__spinner" aria-hidden="true" />
            {{ t('admin.snapshots.loading') }}
        </p>

        <template v-else-if="problem !== null && problem !== 'upgrading'">
            <div class="admin-card admin-card--error" role="alert">
                <div>
                    <b>{{ t(`admin.snapshots.state.${problem}.title`) }}</b>
                    <p v-if="problem === 'failed' && snapshots.error !== null">{{ errorText(snapshots.error) }}</p>
                    <p v-else>{{ t(`admin.snapshots.state.${problem}.hint`) }}</p>
                </div>
                <AppButton v-if="canRetry" variant="quiet" @click="snapshots.load()">{{ t('admin.snapshots.retry') }}</AppButton>
            </div>
        </template>

        <template v-else>
            <p v-if="problem === 'upgrading'" class="snap-panel__upgrading" role="status">
                {{ t('admin.snapshots.state.upgrading.hint') }}
            </p>
            <div v-if="rows.length === 0" class="admin-card snap-panel__empty">
                <b>{{ t('admin.snapshots.empty.title') }}</b>
                <p>{{ t('admin.snapshots.empty.hint') }}</p>
            </div>
            <SnapshotList
                v-else
                :class="{ 'snap-panel__dim': dimmed }"
                :snapshots="rows"
                :can-act="admin.isUnlocked && !dimmed && !waiting"
            />
        </template>
    </section>
</template>

<style scoped>
.snap-panel {
    display: grid;
    gap: var(--space-4);
}

.snap-panel__refused {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
}

.snap-panel p {
    color: var(--c-text-muted);
    font-size: 0.9375rem;
}

.snap-panel__loading {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.snap-panel__spinner {
    animation: snap-spin 1s linear infinite;
}

@keyframes snap-spin {
    to {
        transform: rotate(360deg);
    }
}

@media (prefers-reduced-motion: reduce) {
    .snap-panel__spinner {
        animation: none;
    }
}

.snap-panel__upgrading {
    color: var(--c-warn);
}

.snap-panel__dim {
    opacity: 0.5;
    pointer-events: none;
}
</style>
