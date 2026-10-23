<script setup lang="ts">
// The box's update state as one sentence, and the one action it calls for.
//
// The headline is the status — "up to date", "3 updates available",
// "Updating… 42 %", "restart the box" — never a number in a tile. While an
// upgrade runs, the app's filament (the 2 px band of cyan light under a
// focused field and the active tab) becomes the progress bar: light that
// follows the work.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAdminStore } from '../../stores/admin';
import { useAdminText } from '../../composables/useAdminText';
import AdminButton from './AdminButton.vue';

/** "Restart the box" after a run that needs it; the confirmation lives in AdminActions. */
const emit = defineEmits<{ reboot: [] }>();

const { t } = useI18n();
const admin = useAdminStore();
const { errorText } = useAdminText();

type Phase = 'unknown' | 'upToDate' | 'available' | 'upgrading' | 'done' | 'doneReboot' | 'failed';

const phase = computed<Phase>(() => {
    if (admin.isUpgrading) return 'upgrading';
    const job = admin.job;
    const progress = admin.progress;
    // A finished job stays on screen until the next check: the user who comes
    // back after a restart of calaos-server must see how the run ended.
    if (admin.updates === null && job !== null && job.status !== 'unknown') {
        if (job.status === 'error' || progress?.status === 'error') return 'failed';
        if (job.rebootRequired) return 'doneReboot';
        if (progress?.status === 'done' || job.status === 'done') return 'done';
    }
    if (admin.updates === null) return 'unknown';
    return admin.updates.length === 0 ? 'upToDate' : 'available';
});

const percent = computed(() => Math.round(admin.progress?.totalPercent ?? 0));

const headline = computed(() => {
    switch (phase.value) {
        case 'available':
            return t('admin.updates.available', { count: admin.updates?.length ?? 0 }, admin.updates?.length ?? 0);
        case 'upgrading':
            return t('admin.updates.upgrading', { percent: percent.value });
        default:
            return t(`admin.updates.${phase.value}`);
    }
});

const hint = computed(() => {
    switch (phase.value) {
        case 'upgrading': {
            const p = admin.progress;
            if (p !== null && p.currentPkg !== '' && p.pkgCount > 0) {
                return t('admin.updates.packageOf', {
                    name: p.currentPkg,
                    index: Math.max(1, p.pkgIndex),
                    count: p.pkgCount,
                });
            }
            return p?.message !== '' && p?.message !== undefined ? p.message : t('admin.updates.upgradingHint');
        }
        case 'failed': {
            const reason = admin.job?.error || admin.progress?.error || '';
            return reason !== ''
                ? t('admin.updates.failedReason', { error: reason })
                : t('admin.updates.failedHint');
        }
        default:
            return t(`admin.updates.${phase.value}Hint`);
    }
});

const failure = computed(() => (admin.notice === null ? '' : errorText(admin.notice)));
const checking = computed(() => admin.busy === 'update_check');
const starting = computed(() => admin.busy === 'update_upgrade_all');
const otherBusy = computed(() => admin.busy !== null && !checking.value && !starting.value);
</script>

<template>
    <section class="updates" :class="`updates--${phase}`" aria-labelledby="updates-title">
        <p id="updates-title" class="updates__eyebrow">{{ t('admin.updates.title') }}</p>
        <h2 class="updates__headline" aria-live="polite">{{ headline }}</h2>
        <p class="updates__hint">{{ hint }}</p>

        <div
            v-if="phase === 'upgrading'"
            class="updates__bar"
            role="progressbar"
            :aria-label="t('admin.updates.progress')"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="percent"
        >
            <span class="updates__fill" :style="{ inlineSize: `${percent}%` }" />
        </div>

        <ul v-if="phase === 'available' && admin.updates !== null" class="updates__list">
            <li v-for="entry in admin.updates" :key="entry.name" class="updates__item">
                <span class="updates__name">{{ entry.name }}</span>
                <span class="updates__versions">
                    {{ t('admin.updates.versions', { from: entry.currentVersion, to: entry.version }) }}
                </span>
            </li>
        </ul>

        <p v-if="failure !== ''" class="updates__error fade-in" role="alert">{{ failure }}</p>

        <div v-if="phase !== 'upgrading'" class="updates__actions">
            <AdminButton
                v-if="phase === 'doneReboot'"
                variant="primary"
                :busy="admin.busy === 'system_reboot'"
                :disabled="otherBusy || checking"
                @click="emit('reboot')"
            >
                {{ t('admin.actions.reboot') }}
            </AdminButton>
            <AdminButton
                v-if="phase === 'available'"
                variant="primary"
                :busy="starting"
                :busy-label="t('admin.updates.starting')"
                :disabled="otherBusy || checking"
                @click="admin.upgradeAll()"
            >
                {{ t('admin.updates.upgrade') }}
            </AdminButton>
            <AdminButton
                :variant="phase === 'available' || phase === 'doneReboot' ? 'quiet' : 'primary'"
                :busy="checking"
                :busy-label="t('admin.updates.checking')"
                :disabled="otherBusy || starting"
                @click="admin.checkUpdates()"
            >
                {{ t('admin.updates.check') }}
            </AdminButton>
        </div>
    </section>
</template>

<style scoped>
.updates {
    position: relative;
    padding: var(--space-6);
    background-color: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-lg);
    /* Keeps the filament's glow inside the rounded corners. */
    overflow: hidden;
}

.updates__eyebrow {
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text-muted);
}

.updates__headline {
    margin-block-start: var(--space-2);
    font-size: clamp(1.375rem, 4vw, 1.75rem);
    font-weight: 400;
    letter-spacing: var(--tracking-tight);
    line-height: 1.15;
}

.updates--doneReboot .updates__headline,
.updates--upgrading .updates__headline {
    color: var(--c-accent);
}

.updates--doneReboot .updates__headline {
    color: var(--c-warn);
}

.updates--failed .updates__headline {
    color: var(--c-danger);
}

.updates--upToDate .updates__headline,
.updates--done .updates__headline {
    color: var(--c-success);
}

.updates__hint {
    margin-block-start: var(--space-2);
    color: var(--c-text-muted);
    font-size: 0.9375rem;
    line-height: 1.45;
    max-inline-size: 48ch;
}

/* ---- the filament as a progress bar ----------------------------------- */

.updates__bar {
    position: relative;
    margin-block-start: var(--space-6);
    block-size: 4px;
    border-radius: 2px;
    background-color: rgba(255, 255, 255, 0.08);
    overflow: visible;
}

.updates__fill {
    display: block;
    block-size: 100%;
    border-radius: 2px;
    background-image: linear-gradient(90deg, rgba(56, 176, 211, 0.55), var(--c-accent));
    box-shadow: 0 0 14px var(--c-accent-glow);
    transition: inline-size 600ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

/* ---- the list ------------------------------------------------------- */

.updates__list {
    margin-block-start: var(--space-4);
    border-block-start: 1px solid var(--c-border);
}

.updates__item {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    padding-block: var(--space-2);
    border-block-end: 1px solid var(--c-border);
    font-size: 0.9375rem;
}

.updates__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.updates__versions {
    flex: none;
    color: var(--c-text-muted);
    font-variant-numeric: tabular-nums;
}

.updates__error {
    margin-block-start: var(--space-4);
    color: var(--c-danger);
    font-size: 0.875rem;
    line-height: 1.4;
}

.updates__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-block-start: var(--space-6);
}

@media (max-width: 479px) {
    .updates {
        padding: var(--space-4);
    }

    .updates__actions > * {
        flex: 1 1 100%;
    }
}

@media (prefers-reduced-motion: reduce) {
    .updates__fill {
        transition: none;
    }
}
</style>
