<script setup lang="ts">
// The box runs on a snapshot: read-only, every change lost at the next reboot.
// A household read, so everyone who is signed in sees it, admin or not.

import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import IconWarn from '~icons/mdi/alert-outline';
import { useAuthStore } from '../../stores/auth';
import { useRescueStore } from '../../stores/rescue';

const { t } = useI18n();
const route = useRoute();
const auth = useAuthStore();
const rescue = useRescueStore();

// The page itself is the details.
const onSnapshots = computed(() => route.name === 'adminSnapshots');
</script>

<template>
    <div v-if="auth.isAuthed && rescue.active" class="rescue-banner fade-in" role="status" data-rescue-banner>
        <IconWarn class="rescue-banner__icon" aria-hidden="true" />
        <p class="rescue-banner__text">
            {{
                rescue.snapshot === null
                    ? t('rescue.bannerNoId')
                    : t('rescue.banner', { id: rescue.snapshot })
            }}
        </p>
        <button v-if="!onSnapshots" type="button" class="rescue-banner__details" @click="rescue.infoOpen = true">
            {{ t('rescue.details') }}
        </button>
    </div>
</template>

<style scoped>
.rescue-banner {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-block-size: 44px;
    padding: var(--space-1) var(--space-4);
    background: var(--c-warn-bg);
    border-block-end: 1px solid var(--c-warn-border);
    color: var(--c-warn);
    z-index: var(--z-chrome);
}

.rescue-banner__icon {
    flex: none;
    inline-size: 1.25rem;
    block-size: 1.25rem;
}

.rescue-banner__text {
    flex: 1;
    min-inline-size: 0;
    font-size: 0.875rem;
    line-height: 1.3;
}

.rescue-banner__details {
    flex: none;
    display: inline-flex;
    align-items: center;
    min-block-size: 44px;
    padding: 0 var(--space-2);
    border: 0;
    background: none;
    color: inherit;
    font-size: 0.875rem;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
}

.rescue-banner__details:focus-visible {
    outline: 2px solid var(--c-warn);
    outline-offset: 2px;
}
</style>
