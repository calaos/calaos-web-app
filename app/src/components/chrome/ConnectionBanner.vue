<script setup lang="ts">
// The connection strip. It reports, and does nothing else.
//
// That restraint is the point: the old app treated a websocket error as a
// sign-out and pushed the user to the login screen, so a lift ride or a Wi-Fi
// roam cost you your session. Here a dropped socket updates one store, this
// strip appears (debounced 1 s by the store, so a reconnect that succeeds on
// the first 1 s retry never flashes), and the user keeps their place.
//
// Colour: amber, not the cyan accent. Cyan means "working" everywhere else in
// this app, and the state being reported is precisely that it is not.

import { useI18n } from 'vue-i18n';
import { useConnectionStore } from '../../stores/connection';

const { t } = useI18n();
const connection = useConnectionStore();
</script>

<template>
    <!-- role=status + aria-live=polite: announced at the next pause, never
         interrupting whatever the user is doing. -->
    <p
        v-if="connection.showBanner"
        class="connection-banner fade-in"
        role="status"
        aria-live="polite"
    >
        <span class="connection-banner__dot pulse-soft" aria-hidden="true" />
        <span class="connection-banner__title">{{ t('chrome.connection.lost') }}</span>
        <span class="connection-banner__detail">{{ t('chrome.connection.retrying') }}</span>
    </p>
</template>

<style scoped>
.connection-banner {
    /* Same reason as the navbar: paint the strip above the content row. */
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    block-size: var(--h-banner);
    padding-inline: var(--space-3);
    background: rgba(52, 38, 20, 0.96);
    border-block-end: 1px solid rgba(224, 163, 86, 0.35);
    font-size: 0.8125rem;
    line-height: 1;
    white-space: nowrap;
    overflow: hidden;
    z-index: var(--z-chrome);
}

.connection-banner__dot {
    inline-size: 0.5rem;
    block-size: 0.5rem;
    border-radius: 50%;
    background: var(--c-warn);
    flex: none;
}

.connection-banner__title {
    color: var(--c-warn);
    font-weight: 500;
}

.connection-banner__detail {
    color: var(--c-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
}
</style>
