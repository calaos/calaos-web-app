<script setup lang="ts">
// A phone started or stopped receiving admin codes. Everyone who signs in
// sees it until they acknowledge it: if nobody in the house did this, the
// admin password is known to someone else, and the way out is spelled here.
// A network change the box rolled back by itself takes the same strip.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import IconLanDisconnect from '~icons/mdi/lan-disconnect';
import IconShieldAlert from '~icons/mdi/shield-alert-outline';
import { useAdminAlertsStore } from '../../stores/adminAlerts';
import { useAuthStore } from '../../stores/auth';
import { useAdminDates } from '../../composables/useAdminDates';
import DeviceName from '../admin/DeviceName.vue';

const { t } = useI18n();
const auth = useAuthStore();
const alerts = useAdminAlertsStore();
const { dayTime } = useAdminDates();

const latest = computed(() => alerts.alerts[0] ?? null);
const others = computed(() => alerts.alerts.length - 1);
const rollback = computed(() => latest.value?.kind === 'network_rolled_back');
</script>

<template>
    <section
        v-if="auth.isAuthed && latest !== null"
        class="admin-alert fade-in"
        role="alert"
        :aria-label="t('admin.alerts.label')"
    >
        <IconLanDisconnect v-if="rollback" class="admin-alert__icon" aria-hidden="true" />
        <IconShieldAlert v-else class="admin-alert__icon" aria-hidden="true" />
        <div class="admin-alert__body">
            <p v-if="rollback" class="admin-alert__title">
                {{ t('admin.network.alert.title', { intf: latest.deviceName }) }}
            </p>
            <i18n-t v-else :keypath="`admin.alerts.${latest.kind}`" tag="p" class="admin-alert__title" scope="global">
                <template #name>
                    <span class="admin-alert__name">{{ t('admin.alerts.quoteOpen') }}<DeviceName :name="latest.deviceName" />{{ t('admin.alerts.quoteClose') }}</span>
                </template>
            </i18n-t>
            <p class="admin-alert__meta">
                <span v-if="Number.isFinite(latest.at)">{{ t('admin.alerts.when', { date: dayTime(latest.at) }) }}</span>
                <span v-if="others > 0">{{ t('admin.alerts.more', { count: others }, others) }}</span>
            </p>
            <p class="admin-alert__hint">{{ rollback ? t('admin.network.alert.hint') : t('admin.alerts.hint') }}</p>
        </div>
        <button type="button" class="admin-alert__dismiss" @click="alerts.dismiss()">
            {{ t('admin.alerts.dismiss') }}
        </button>
    </section>
</template>

<style scoped>
/* The connection strip's amber, grown to a paragraph: same family of news
   (something about the box you should know), but this one needs reading. */
.admin-alert {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: rgba(52, 38, 20, 0.96);
    border-block-end: 1px solid rgba(224, 163, 86, 0.35);
    z-index: var(--z-chrome);
}

.admin-alert__icon {
    flex: none;
    inline-size: 1.375rem;
    block-size: 1.375rem;
    margin-block-start: 0.0625rem;
    color: var(--c-warn);
}

.admin-alert__body {
    flex: 1;
    min-inline-size: 0;
}

.admin-alert__body > * {
    max-inline-size: 44rem;
}

.admin-alert__name {
    white-space: nowrap;
}

.admin-alert__title {
    color: var(--c-warn);
    font-size: 0.9375rem;
    font-weight: 500;
    line-height: 1.35;
    overflow-wrap: anywhere;
}

.admin-alert__meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    margin-block-start: var(--space-1);
    color: var(--c-text);
    font-size: 0.8125rem;
}

.admin-alert__hint {
    margin-block-start: var(--space-1);
    color: var(--c-text-muted);
    font-size: 0.8125rem;
    line-height: 1.4;
}

.admin-alert__dismiss {
    flex: none;
    margin-inline-start: auto;
    padding: var(--space-1) var(--space-3);
    border: 1px solid rgba(224, 163, 86, 0.6);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--c-warn);
    font-size: 0.8125rem;
    cursor: pointer;
}

.admin-alert__dismiss:focus-visible {
    outline: 2px solid var(--c-warn);
    outline-offset: 2px;
}

@media (max-width: 479px) {
    .admin-alert {
        flex-wrap: wrap;
    }

    .admin-alert__dismiss {
        min-block-size: 44px;
        margin-inline-start: calc(1.375rem + var(--space-3));
    }
}
</style>
