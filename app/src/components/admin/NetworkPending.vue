<script setup lang="ts">
// The change on trial: the box's countdown, the two ways out, and — when
// this client made the change — where to find the box if it moved. That
// address is shown before anything goes wrong, because a box that changes
// address mostly leaves the socket hanging rather than closing it.

import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { networkReopenUrl } from '../../protocol/admin-network';
import type { AdminError } from '../../protocol/admin';
import { useAdminNetworkStore } from '../../stores/adminNetwork';
import { useConnectionStore } from '../../stores/connection';
import { useAdminText } from '../../composables/useAdminText';
import { useNetworkCountdown } from '../../composables/useNetworkCountdown';
import AdminButton from './AdminButton.vue';

const LOW_SECONDS = 30;

const { t } = useI18n();
const network = useAdminNetworkStore();
const connection = useConnectionStore();
const { errorText } = useAdminText();

const busy = ref<'confirm' | 'revert' | null>(null);
const failure = ref<AdminError | null>(null);

const countdown = useNetworkCountdown(() => network.pending?.deadline ?? network.lostDeadline);

const change = computed(() => network.pending?.change ?? network.lostApply);
const intf = computed(() => network.pending?.intf ?? network.lostApply?.intf ?? '');
const expired = computed(() => countdown.seconds.value === 0);
const low = computed(() => (countdown.seconds.value ?? 0) <= LOW_SECONDS);
/** The reply never came, or the socket is down: the box may well be elsewhere. */
const lost = computed(() => network.lostApply !== null || !connection.isOpen);
const reopenUrl = computed(() => (change.value === null ? '' : networkReopenUrl(change.value, window.location)));
const canAct = computed(() => network.pending !== null && connection.isOpen && !expired.value && busy.value === null);

async function act(what: 'confirm' | 'revert'): Promise<void> {
    busy.value = what;
    failure.value = null;
    const error = what === 'confirm' ? await network.confirm() : await network.revert();
    busy.value = null;
    if (error !== null && error.code !== 'busy') failure.value = error;
}
</script>

<template>
    <section
        class="net-pending fade-in"
        :class="{ 'net-pending--low': low, 'net-pending--over': expired }"
        :aria-label="t('admin.network.pending.title', { intf })"
    >
        <span
            class="net-pending__filament"
            :style="{ transform: `scaleX(${countdown.fraction.value})` }"
            aria-hidden="true"
        />
        <div class="net-pending__main">
            <p class="net-pending__clock" role="timer" :aria-label="t('admin.network.pending.countdown', { time: countdown.clock.value })">
                {{ countdown.clock.value }}
            </p>
            <div class="net-pending__text">
                <h2 class="net-pending__title">{{ t('admin.network.pending.title', { intf }) }}</h2>
                <p class="net-pending__hint">
                    {{ expired ? t('admin.network.pending.expired') : t('admin.network.pending.hint') }}
                </p>
                <div v-if="!expired" class="net-pending__actions">
                    <AdminButton
                        :busy="busy === 'confirm'"
                        :disabled="!canAct"
                        @click="act('confirm')"
                    >
                        {{ t('admin.network.pending.confirm') }}
                    </AdminButton>
                    <AdminButton
                        variant="quiet"
                        :busy="busy === 'revert'"
                        :disabled="!canAct"
                        @click="act('revert')"
                    >
                        {{ t('admin.network.pending.revert') }}
                    </AdminButton>
                </div>
                <p v-if="failure !== null" class="net-pending__error" role="alert">{{ errorText(failure) }}</p>
            </div>
        </div>

        <div
            v-if="change !== null && !expired"
            class="net-pending__reopen"
            :class="{ 'net-pending__reopen--lost': lost }"
            :role="lost ? 'alert' : undefined"
        >
            <p v-if="lost" class="net-pending__lost">{{ t('admin.network.pending.lost') }}</p>
            <template v-if="reopenUrl !== ''">
                <p>{{ lost ? t('admin.network.pending.reopenNow') : t('admin.network.pending.reopen') }}</p>
                <a class="net-pending__url" :href="reopenUrl">{{ reopenUrl }}</a>
            </template>
            <p v-else>{{ t('admin.network.pending.reopenDhcp') }}</p>
        </div>
    </section>
</template>

<style scoped>
/* The one loud thing on the page: the window closing, as the app's cyan
   filament burning down along the panel's top edge. */
.net-pending {
    position: relative;
    padding: var(--space-6);
    background-color: var(--c-surface);
    border: 1px solid rgba(56, 176, 211, 0.35);
    border-radius: var(--radius-lg);
    overflow: hidden;
}

.net-pending--low {
    border-color: rgba(224, 163, 86, 0.45);
}

.net-pending--over {
    border-color: var(--c-border);
}

.net-pending__filament {
    position: absolute;
    inset-block-start: 0;
    inset-inline: 0;
    block-size: 3px;
    background-image: linear-gradient(90deg, rgba(56, 176, 211, 0.4), var(--c-accent));
    box-shadow: 0 0 16px var(--c-accent-glow);
    transform-origin: left center;
    transition: transform 250ms linear;
}

.net-pending--low .net-pending__filament {
    background-image: linear-gradient(90deg, rgba(224, 163, 86, 0.4), var(--c-warn));
    box-shadow: 0 0 16px rgba(224, 163, 86, 0.45);
}

.net-pending__main {
    display: grid;
    gap: var(--space-4);
}

@media (min-width: 560px) {
    .net-pending__main {
        grid-template-columns: auto 1fr;
        gap: var(--space-6);
        align-items: start;
    }
}

.net-pending__clock {
    font-size: clamp(3rem, 14vw, 4.25rem);
    font-weight: 300;
    line-height: 0.9;
    letter-spacing: var(--tracking-tight);
    font-variant-numeric: tabular-nums;
    color: var(--c-accent);
}

.net-pending--low .net-pending__clock {
    color: var(--c-warn);
}

.net-pending--over .net-pending__clock {
    color: var(--c-text-muted);
}

.net-pending__title {
    font-size: 1.25rem;
    font-weight: 400;
    letter-spacing: var(--tracking-tight);
    line-height: 1.2;
}

.net-pending__hint {
    margin-block-start: var(--space-2);
    color: var(--c-text-muted);
    font-size: 0.9375rem;
    line-height: 1.45;
    max-inline-size: 48ch;
}

.net-pending__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-block-start: var(--space-4);
}

.net-pending__error {
    margin-block-start: var(--space-3);
    color: var(--c-danger-text);
    font-size: 0.875rem;
    line-height: 1.4;
}

.net-pending__reopen {
    display: grid;
    gap: var(--space-2);
    margin-block-start: var(--space-6);
    padding-block-start: var(--space-4);
    border-block-start: 1px solid var(--c-border);
    color: var(--c-text-muted);
    font-size: 0.9375rem;
    line-height: 1.45;
}

.net-pending__reopen--lost {
    margin-inline: calc(-1 * var(--space-6));
    margin-block-end: calc(-1 * var(--space-6));
    padding: var(--space-4) var(--space-6) var(--space-6);
    border-block-start-color: rgba(224, 163, 86, 0.35);
    background-color: rgba(52, 38, 20, 0.6);
}

.net-pending__lost {
    color: var(--c-warn);
    font-weight: 500;
}

.net-pending__url {
    justify-self: start;
    color: var(--c-accent);
    font-size: 1.0625rem;
    overflow-wrap: anywhere;
    text-underline-offset: 3px;
}

.net-pending__url:focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
}

@media (max-width: 479px) {
    .net-pending {
        padding: var(--space-4);
    }

    .net-pending__reopen--lost {
        margin-inline: calc(-1 * var(--space-4));
        margin-block-end: calc(-1 * var(--space-4));
        padding-inline: var(--space-4);
        padding-block-end: var(--space-4);
    }

    .net-pending__actions > * {
        flex: 1 1 100%;
    }
}

@media (prefers-reduced-motion: reduce) {
    .net-pending__filament {
        transition: none;
    }
}
</style>
