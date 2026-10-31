// Where the box's updates stand: shared by the updates page and its hub tile,
// which must never tell two different stories.

import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAdminStore } from '../stores/admin';

export type UpdatesPhase =
    | 'unknown'
    | 'upToDate'
    | 'available'
    | 'upgrading'
    | 'done'
    | 'doneReboot'
    | 'failed';

export function useUpdatesPhase(): {
    phase: ComputedRef<UpdatesPhase>;
    percent: ComputedRef<number>;
    headline: ComputedRef<string>;
} {
    const { t } = useI18n();
    const admin = useAdminStore();

    const phase = computed<UpdatesPhase>(() => {
        if (admin.isUpgrading) return 'upgrading';
        // A job that ended during this visit, or recently, is news; an older
        // one is history and the panel starts afresh.
        const job = admin.recentJob;
        if (admin.updates === null && job !== null) {
            if (job.status === 'error') return 'failed';
            if (job.rebootRequired) return 'doneReboot';
            return 'done';
        }
        if (admin.updates === null) return 'unknown';
        return admin.updates.length === 0 ? 'upToDate' : 'available';
    });

    const percent = computed(() => Math.round(admin.progress?.totalPercent ?? 0));

    const headline = computed(() => {
        const count = admin.updates?.length ?? 0;
        switch (phase.value) {
            case 'available':
                return t('admin.updates.available', { count }, count);
            case 'upgrading':
                return t('admin.updates.upgrading', { percent: percent.value });
            default:
                return t(`admin.updates.${phase.value}`);
        }
    });

    return { phase, percent, headline };
}
