<script setup lang="ts">
// The box's services as the same hairline list as the box actions, each with
// a status light and the verbs the daemon offers for that row. What takes
// something away asks first, then the row follows the action until the list
// shows its outcome; restarting what carries this page's connection says so
// and waits for the reconnect.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { TIME_SERVICE_ID } from '../../protocol/admin-services';
import type { ServiceState, ServiceVerb } from '../../protocol/admin-services';
import { useAdminStore } from '../../stores/admin';
import { serviceDeadlineMs, useAdminServicesStore } from '../../stores/adminServices';
import type { ServiceResult } from '../../stores/adminServices';
import { useAdminDates } from '../../composables/useAdminDates';
import { useAdminText } from '../../composables/useAdminText';
import BaseDialog from '../ui/BaseDialog.vue';
import AdminButton from './AdminButton.vue';
import AdminSwitch from './AdminSwitch.vue';

const REFRESH_MS = 10_000;

const { t, te } = useI18n();
const admin = useAdminStore();
const services = useAdminServicesStore();
const { elapsed } = useAdminDates();
const { errorText } = useAdminText();

const confirming = ref<{ entry: ServiceState; verb: ServiceVerb } | null>(null);
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function refresh(): void {
    if (document.visibilityState !== 'visible' || !admin.isUnlocked || services.working) return;
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
const blocked = computed(() => admin.isUpgrading || admin.busy !== null);

// The dialog's button would only earn a 409 once the update runs.
watch(
    () => admin.isUpgrading,
    (upgrading) => {
        if (upgrading) confirming.value = null;
    },
);

function nameOf(id: string): string {
    const key = `admin.services.name.${id}`;
    return te(key) ? t(key) : id;
}

const selfName = computed(() => (services.selfId === null ? '' : nameOf(services.selfId)));

function isMasked(entry: ServiceState): boolean {
    return entry.startup === 'masked';
}

/** Masked or missing, a row has nothing to act on, whatever the daemon lists. */
function isOutOfReach(entry: ServiceState): boolean {
    return isMasked(entry) || entry.activeState === 'not-found';
}

function isTracked(entry: ServiceState): boolean {
    return services.tracked[entry.id] !== undefined;
}

/** A running service restarts or stops; a stopped one only starts. */
function verbsOf(entry: ServiceState): ServiceVerb[] {
    if (isOutOfReach(entry)) return [];
    const offered = (verb: ServiceVerb): boolean => entry.actions.includes(verb);
    if (entry.activeState === 'inactive' || entry.activeState === 'failed') {
        if (offered('start')) return ['start'];
        return offered('restart') ? ['restart'] : [];
    }
    return (['restart', 'stop'] as const).filter(offered);
}

function hasSwitch(entry: ServiceState): boolean {
    return (
        entry.id !== TIME_SERVICE_ID &&
        !isOutOfReach(entry) &&
        entry.actions.includes('enable') &&
        entry.actions.includes('disable') &&
        (entry.startup === 'enabled' || entry.startup === 'disabled')
    );
}

function hasTimeLink(entry: ServiceState): boolean {
    return entry.id === TIME_SERVICE_ID && !isOutOfReach(entry);
}

function lightOf(entry: ServiceState): string {
    if (isTracked(entry)) return 'working';
    return isMasked(entry) ? 'not-found' : entry.activeState;
}

/** `since` is when the unit last became active: for a stopped service it is history, not state. */
function meta(entry: ServiceState): string {
    if (isMasked(entry)) return t('admin.services.state.masked');
    const state = t(`admin.services.state.${entry.activeState}`);
    if (entry.activeState !== 'active' || entry.since === '') return state;
    return t('admin.services.runningSince', { state, when: elapsed(entry.since) });
}

function resultText(entry: ServiceState, result: ServiceResult): string {
    switch (result.status) {
        case 'error':
            return result.error.code === 'upgrade_in_progress'
                ? t('admin.services.result.upgrade_in_progress')
                : errorText(result.error);
        case 'done':
        case 'failed':
            return t(`admin.services.result.${result.status}.${result.verb}`);
        case 'timeout':
            return t('admin.services.result.timeout', { seconds: serviceDeadlineMs(entry.id) / 1000 });
        case 'not_found':
            return t('admin.services.result.not_found');
    }
}

function tone(result: ServiceResult): 'ok' | 'warn' | 'danger' {
    if (result.status === 'done') return 'ok';
    if (result.status === 'failed' || result.status === 'error') return 'danger';
    return 'warn';
}

/** A manual start lasts until the next boot, which the row should not leave unsaid. */
function needsStartNote(entry: ServiceState, result: ServiceResult): boolean {
    return result.status === 'done' && result.verb === 'start' && entry.startup === 'disabled';
}

function busyLabel(id: string): string {
    const item = services.tracked[id];
    if (item === undefined) return '';
    return t(item.phase === 'reconnecting' ? 'admin.services.reconnecting' : `admin.services.busy.${item.verb}`);
}

const dialogTitle = computed(() => {
    if (confirming.value === null) return '';
    const name = nameOf(confirming.value.entry.id);
    switch (confirming.value.verb) {
        case 'stop':
            return t('admin.services.stopTitle', { name });
        case 'disable':
            return t('admin.services.disableTitle', { name });
        default:
            return t('admin.services.confirmTitle', { name });
    }
});

const dialogConfirm = computed(() => {
    const verb = confirming.value?.verb;
    if (verb === 'stop') return t('admin.services.stop');
    return verb === 'disable' ? t('admin.services.disableConfirm') : t('admin.services.restart');
});

const dialogDanger = computed(() => confirming.value !== null && confirming.value.verb !== 'restart');

const dialogConsequence = computed(() => {
    const key = `admin.services.consequence.${confirming.value?.entry.id}`;
    return dialogDanger.value && te(key) ? t(key) : '';
});

const dialogWarning = computed(() => {
    const key = `admin.services.restartWarning.${confirming.value?.entry.id}`;
    return !dialogDanger.value && te(key) ? t(key) : '';
});

/** Starting asks nothing: it takes nothing away, and it can be stopped again. */
function ask(entry: ServiceState, verb: ServiceVerb): void {
    services.dismiss(entry.id);
    if (verb === 'start' || verb === 'enable') void services.actAndWatch(entry.id, verb);
    else confirming.value = { entry, verb };
}

function confirm(): void {
    const asked = confirming.value;
    confirming.value = null;
    if (asked !== null) void services.actAndWatch(asked.entry.id, asked.verb);
}
</script>

<template>
    <section class="services" :aria-label="t('admin.services.title')">
        <p v-if="services.selfPhase !== null" class="services__banner fade-in" role="status">
            {{ t('admin.services.selfRestarting', { name: selfName }) }}
        </p>
        <p v-else-if="admin.isUpgrading" class="services__banner services__banner--warn fade-in" role="status">
            {{ t('admin.services.upgrading') }}
        </p>

        <ul class="services__list admin-list">
            <li v-if="services.error !== null && services.services === null" class="services__row admin-card">
                <div class="services__text">
                    <span class="services__name">{{ t('admin.services.loadFailed') }}</span>
                    <span class="services__meta">{{ errorText(services.error) }}</span>
                </div>
                <AdminButton variant="quiet" @click="services.load()">{{ t('admin.services.retry') }}</AdminButton>
            </li>

            <li v-else-if="services.services === null" class="services__row admin-card">
                <span class="services__meta">{{ t('admin.services.loading') }}</span>
            </li>

            <li
                v-for="entry in list"
                :key="entry.id"
                class="services__row admin-card"
                :class="{ 'services__row--busy': isTracked(entry) }"
                :data-service="entry.id"
            >
                <span class="services__light" :class="`services__light--${lightOf(entry)}`" aria-hidden="true" />
                <div class="services__text">
                    <span class="services__name">{{ nameOf(entry.id) }}</span>
                    <span class="services__meta">{{ meta(entry) }}</span>
                    <template v-if="services.results[entry.id] !== undefined">
                        <span
                            class="services__result fade-in"
                            :class="`services__result--${tone(services.results[entry.id])}`"
                            :role="tone(services.results[entry.id]) === 'ok' ? 'status' : 'alert'"
                        >
                            {{ resultText(entry, services.results[entry.id]) }}
                        </span>
                        <span v-if="needsStartNote(entry, services.results[entry.id])" class="services__note fade-in">
                            {{ t('admin.services.startNote') }}
                        </span>
                    </template>
                </div>
                <div class="services__controls">
                    <RouterLink
                        v-if="hasTimeLink(entry)"
                        class="services__link"
                        :to="{ name: 'adminTime' }"
                    >
                        {{ t('admin.services.timeLink') }}
                    </RouterLink>
                    <AdminSwitch
                        v-else-if="hasSwitch(entry)"
                        :checked="entry.startup === 'enabled'"
                        :label="t('admin.services.startAtBoot')"
                        :aria-label="t('admin.services.startAtBootOf', { name: nameOf(entry.id) })"
                        :busy="isTracked(entry)"
                        :disabled="blocked || isTracked(entry)"
                        @click="ask(entry, entry.startup === 'enabled' ? 'disable' : 'enable')"
                    />
                    <AdminButton
                        v-if="isTracked(entry)"
                        variant="quiet"
                        busy
                        :busy-label="busyLabel(entry.id)"
                    >
                        {{ busyLabel(entry.id) }}
                    </AdminButton>
                    <template v-else>
                        <AdminButton
                            v-for="verb in verbsOf(entry)"
                            :key="verb"
                            variant="quiet"
                            :disabled="blocked"
                            @click="ask(entry, verb)"
                        >
                            {{ t(`admin.services.${verb}`) }}
                        </AdminButton>
                    </template>
                    <span v-if="entry.actions.length === 0 && !isOutOfReach(entry)" class="services__tag">
                        {{ t('admin.services.statusOnly') }}
                    </span>
                </div>
            </li>
        </ul>

        <BaseDialog
            :open="confirming !== null"
            :title="dialogTitle"
            :confirm-label="dialogConfirm"
            :cancel-label="t('dialog.cancel')"
            :danger="dialogDanger"
            @confirm="confirm"
            @cancel="confirming = null"
        >
            <p v-if="dialogConsequence !== ''" class="services__dialog-hint services__consequence">
                {{ dialogConsequence }}
            </p>
            <p v-if="confirming?.verb === 'stop'" class="services__dialog-hint">
                {{ t('admin.services.stopHint') }}
            </p>
            <p v-else-if="confirming?.verb === 'restart'" class="services__dialog-hint">
                {{ t('admin.services.confirmHint') }}
            </p>
            <p v-if="dialogWarning !== ''" class="services__warning">{{ dialogWarning }}</p>
        </BaseDialog>
    </section>
</template>

<style scoped>
.services__banner {
    margin-block-start: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid color-mix(in srgb, var(--c-accent) 35%, transparent);
    border-radius: var(--radius-md);
    background-color: color-mix(in srgb, var(--c-accent) 8%, transparent);
    color: var(--c-accent);
    font-size: 0.9375rem;
    line-height: 1.45;
}

.services__banner--warn {
    border-color: color-mix(in srgb, var(--c-warn) 35%, transparent);
    background-color: color-mix(in srgb, var(--c-warn) 8%, transparent);
    color: var(--c-warn);
}

.services__list {
    margin-block-start: var(--space-3);
}

.services__row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
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
    box-shadow: 0 0 8px color-mix(in srgb, var(--c-success) 55%, transparent);
}

.services__light--failed {
    background-color: var(--c-danger);
    box-shadow: 0 0 8px color-mix(in srgb, var(--c-danger) 55%, transparent);
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

.services__note {
    color: var(--c-text-muted);
    font-size: 0.875rem;
    line-height: 1.4;
}

.services__controls {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2) var(--space-4);
}

.services__link {
    display: inline-flex;
    align-items: center;
    min-block-size: 2.75rem;
    color: var(--c-accent);
    font-size: 0.875rem;
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

.services__consequence {
    margin-block-end: var(--space-2);
    color: var(--c-text);
}

.services__warning {
    margin-block-start: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid color-mix(in srgb, var(--c-warn) 35%, transparent);
    border-radius: var(--radius-md);
    background-color: color-mix(in srgb, var(--c-warn) 10%, transparent);
    color: var(--c-warn);
    font-size: 0.875rem;
    line-height: 1.45;
}

@media (max-width: 599px) {
    .services__row {
        flex-wrap: wrap;
    }

    .services__text {
        flex-basis: calc(100% - 0.625rem - var(--space-4));
    }

    /* Aligned on the text, past the light. */
    .services__controls {
        flex: 1 1 100%;
        justify-content: flex-start;
        padding-inline-start: calc(0.625rem + var(--space-4));
    }
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
