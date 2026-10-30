<script setup lang="ts">
// The box's services as the same hairline list as the box actions, each
// with a status light. A restart asks once, then the row follows it until the
// list shows the new process; restarting calaos-server takes this page's
// connection with it, so the panel says so and waits for the reconnect.

import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { SELF_SERVICE_ID } from '../../protocol/admin-services';
import type { ServiceState } from '../../protocol/admin-services';
import { useAdminStore } from '../../stores/admin';
import {
    RESTART_DEADLINE_MS,
    SELF_RESTART_DEADLINE_MS,
    useAdminServicesStore,
} from '../../stores/adminServices';
import type { RestartResult } from '../../stores/adminServices';
import { useAdminDates } from '../../composables/useAdminDates';
import { useAdminText } from '../../composables/useAdminText';
import BaseDialog from '../ui/BaseDialog.vue';
import AdminButton from './AdminButton.vue';

const REFRESH_MS = 10_000;

const { t, te } = useI18n();
const admin = useAdminStore();
const services = useAdminServicesStore();
const { ago } = useAdminDates();
const { errorText } = useAdminText();

const confirming = ref<ServiceState | null>(null);
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function refresh(): void {
    if (document.visibilityState !== 'visible' || !admin.isUnlocked || services.restarting) return;
    void services.load();
}

onMounted(() => {
    void services.load();
    refreshTimer = setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
});

onBeforeUnmount(() => {
    if (refreshTimer !== null) clearInterval(refreshTimer);
    document.removeEventListener('visibilitychange', refresh);
});

const list = computed(() => services.services ?? []);
const blocked = computed(() => admin.isUpgrading);

function nameOf(entry: ServiceState): string {
    const key = `admin.services.name.${entry.id}`;
    return te(key) ? t(key) : entry.id;
}

function canAct(entry: ServiceState): boolean {
    return entry.restartable && entry.activeState !== 'not-found';
}

/** `since` is when the unit last became active: for a stopped service it is history, not state. */
function meta(entry: ServiceState): string {
    const state = t(`admin.services.state.${entry.activeState}`);
    if (entry.since === '') return state;
    if (entry.kind === 'oneshot') return `${state}, ${t('admin.services.lastRun', { when: ago(entry.since) })}`;
    if (entry.activeState !== 'active') return state;
    return `${state}, ${t('admin.services.since', { when: ago(entry.since) })}`;
}

function resultText(entry: ServiceState, result: RestartResult): string {
    if (result.status === 'error') {
        return result.error.code === 'upgrade_in_progress'
            ? t('admin.services.result.upgrade_in_progress')
            : errorText(result.error);
    }
    if (result.status === 'done') return t(`admin.services.result.${entry.kind === 'oneshot' ? 'ran' : 'done'}`);
    if (result.status === 'timeout') {
        const ms = entry.id === SELF_SERVICE_ID ? SELF_RESTART_DEADLINE_MS : RESTART_DEADLINE_MS;
        return t('admin.services.result.timeout', { seconds: ms / 1000 });
    }
    return t(`admin.services.result.${result.status}`);
}

function tone(result: RestartResult): 'ok' | 'warn' | 'danger' {
    if (result.status === 'done') return 'ok';
    if (result.status === 'failed' || result.status === 'error') return 'danger';
    return 'warn';
}

function busyLabel(id: string): string {
    return services.tracked[id]?.phase === 'reconnecting'
        ? t('admin.services.reconnecting')
        : t('admin.services.restarting');
}

const dialogTitle = computed(() => {
    const entry = confirming.value;
    if (entry === null) return '';
    const name = nameOf(entry);
    return entry.kind === 'oneshot'
        ? t('admin.services.runTitle', { name })
        : t('admin.services.confirmTitle', { name });
});

function ask(entry: ServiceState): void {
    services.dismiss(entry.id);
    confirming.value = entry;
}

function confirm(): void {
    const entry = confirming.value;
    confirming.value = null;
    if (entry !== null) void services.restartAndWatch(entry.id);
}
</script>

<template>
    <section class="services" :aria-label="t('admin.services.title')">
        <p v-if="services.selfPhase !== null" class="services__banner fade-in" role="status">
            {{ t('admin.services.selfRestarting') }}
        </p>
        <p v-else-if="blocked" class="services__banner services__banner--warn fade-in" role="status">
            {{ t('admin.services.upgrading') }}
        </p>

        <ul class="services__list">
            <li v-if="services.error !== null && services.services === null" class="services__row">
                <div class="services__text">
                    <span class="services__name">{{ t('admin.services.loadFailed') }}</span>
                    <span class="services__meta">{{ errorText(services.error) }}</span>
                </div>
                <AdminButton variant="quiet" @click="services.load()">{{ t('admin.services.retry') }}</AdminButton>
            </li>

            <li v-else-if="services.services === null" class="services__row">
                <span class="services__meta">{{ t('admin.services.loading') }}</span>
            </li>

            <li
                v-for="entry in list"
                :key="entry.id"
                class="services__row"
                :class="{ 'services__row--busy': services.tracked[entry.id] !== undefined }"
                :data-service="entry.id"
            >
                <span
                    class="services__light"
                    :class="`services__light--${services.tracked[entry.id] !== undefined ? 'working' : entry.activeState}`"
                    aria-hidden="true"
                />
                <div class="services__text">
                    <span class="services__name">{{ nameOf(entry) }}</span>
                    <span class="services__meta">{{ meta(entry) }}</span>
                    <span
                        v-if="services.results[entry.id] !== undefined"
                        class="services__result fade-in"
                        :class="`services__result--${tone(services.results[entry.id])}`"
                        :role="tone(services.results[entry.id]) === 'ok' ? 'status' : 'alert'"
                    >
                        {{ resultText(entry, services.results[entry.id]) }}
                    </span>
                </div>
                <AdminButton
                    v-if="canAct(entry)"
                    variant="quiet"
                    :busy="services.tracked[entry.id] !== undefined"
                    :busy-label="busyLabel(entry.id)"
                    :disabled="blocked || admin.busy !== null"
                    @click="ask(entry)"
                >
                    {{ entry.kind === 'oneshot' ? t('admin.services.runNow') : t('admin.services.restart') }}
                </AdminButton>
                <span v-else-if="!entry.restartable" class="services__tag">{{ t('admin.services.statusOnly') }}</span>
            </li>
        </ul>

        <BaseDialog
            :open="confirming !== null"
            :title="dialogTitle"
            :confirm-label="
                confirming?.kind === 'oneshot' ? t('admin.services.runNow') : t('admin.services.restart')
            "
            :cancel-label="t('dialog.cancel')"
            @confirm="confirm"
            @cancel="confirming = null"
        >
            <p class="services__dialog-hint">
                {{ confirming?.kind === 'oneshot' ? t('admin.services.runHint') : t('admin.services.confirmHint') }}
            </p>
            <p v-if="confirming?.id === SELF_SERVICE_ID" class="services__warning">
                {{ t('admin.services.selfRestartWarning') }}
            </p>
        </BaseDialog>
    </section>
</template>

<style scoped>
.services__banner {
    margin-block-start: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid rgba(56, 176, 211, 0.35);
    border-radius: var(--radius-md);
    background-color: rgba(56, 176, 211, 0.08);
    color: var(--c-accent);
    font-size: 0.9375rem;
    line-height: 1.45;
}

.services__banner--warn {
    border-color: rgba(224, 163, 86, 0.35);
    background-color: rgba(224, 163, 86, 0.08);
    color: var(--c-warn);
}

.services__list {
    margin-block-start: var(--space-3);
    border-block-start: 1px solid var(--c-border);
}

.services__row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-2);
    border-block-end: 1px solid var(--c-border);
}

.services__text {
    flex: 1;
    display: grid;
    gap: var(--space-1);
    min-inline-size: 0;
}

.services__name {
    font-size: 1rem;
    overflow-wrap: anywhere;
}

.services__meta {
    color: var(--c-text-muted);
    font-size: 0.875rem;
    line-height: 1.4;
}

/* The box's own status LED: lit and glowing when running, dark when
   stopped, an empty socket when the unit is not installed. */
.services__light {
    flex: none;
    align-self: flex-start;
    margin-block-start: 0.4rem;
    inline-size: 0.625rem;
    block-size: 0.625rem;
    border-radius: 50%;
    background-color: var(--c-track);
}

.services__light--active {
    background-color: var(--c-success);
    box-shadow: 0 0 8px rgba(76, 175, 125, 0.55);
}

.services__light--failed {
    background-color: var(--c-danger);
    box-shadow: 0 0 8px rgba(224, 86, 86, 0.55);
}

.services__light--inactive,
.services__light--unknown {
    background-color: var(--c-border-strong);
}

.services__light--not-found {
    background-color: transparent;
    border: 1px solid var(--c-track);
}

.services__light--activating,
.services__light--deactivating,
.services__light--reloading,
.services__light--working {
    background-color: var(--c-accent);
    box-shadow: 0 0 10px var(--c-accent-glow);
    animation: services-breathe 1.4s ease-in-out infinite;
}

@keyframes services-breathe {
    50% {
        opacity: 0.35;
        box-shadow: none;
    }
}

.services__result {
    font-size: 0.875rem;
    line-height: 1.4;
}

.services__result--ok {
    color: var(--c-success);
}

.services__result--warn {
    color: var(--c-warn);
}

.services__result--danger {
    color: var(--c-danger-text);
}

.services__tag {
    flex: none;
    color: var(--c-text-muted);
    font-size: 0.8125rem;
}

.services__dialog-hint {
    color: var(--c-text-muted);
    font-size: 0.9375rem;
    line-height: 1.45;
}

.services__warning {
    margin-block-start: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid rgba(224, 163, 86, 0.35);
    border-radius: var(--radius-md);
    background-color: rgba(52, 38, 20, 0.6);
    color: var(--c-warn);
    font-size: 0.875rem;
    line-height: 1.45;
}

@media (prefers-reduced-motion: reduce) {
    .services__light--activating,
    .services__light--deactivating,
    .services__light--reloading,
    .services__light--working {
        animation: none;
    }
}
</style>
