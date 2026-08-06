<script setup lang="ts">
// Top chrome: back (detail routes only), wordmark, sign out.
//
// Kept from the old app: the 48px height, the #3c3c3c→#111 gradient and the
// hairline under it. Changed: the wordmark is centred in a three-column grid
// instead of floated left with the buttons layered over it, so the back
// button can appear and disappear without shifting the title; and the icon is
// `mdi:logout` — the old markup asked for `fa-sign-out`, which does not exist
// in Font Awesome 5, so that button rendered as an empty box.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import IconArrowLeft from '~icons/mdi/arrow-left';
import IconLogout from '~icons/mdi/logout';
import IconButton from '../ui/IconButton.vue';
import { useAuthStore } from '../../stores/auth';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const canGoBack = computed(() => route.meta.detail === true);

function goBack(): void {
    // Not router.back(): a deep link opened straight into /home/3 has no
    // history entry to go back to, and the old app's $window.history.back()
    // left the user on whatever page preceded the app. Walking one path
    // segment up is always defined.
    const parent = route.path.slice(0, route.path.lastIndexOf('/')) || '/home';
    void router.push(parent);
}
</script>

<template>
    <header class="navbar fade-in-down">
        <div class="navbar__slot navbar__slot--start">
            <IconButton v-if="canGoBack" :label="t('chrome.back')" @click="goBack">
                <IconArrowLeft />
            </IconButton>
        </div>

        <p class="navbar__wordmark">{{ t('app.name') }}</p>

        <div class="navbar__slot navbar__slot--end">
            <IconButton :label="t('chrome.signOut')" @click="auth.signOut()">
                <IconLogout />
            </IconButton>
        </div>
    </header>
</template>

<style scoped>
.navbar {
    /* positioned so z-index applies: as a plain grid item the bar paints
       BEFORE the content row and its drop shadow lands underneath it. */
    position: relative;
    display: grid;
    /* Equal side slots keep the wordmark optically centred whether or not
       the back button is mounted. */
    grid-template-columns: 3.5rem 1fr 3.5rem;
    align-items: center;
    block-size: var(--h-navbar);
    /* content-box (overriding the global border-box) so the notch inset is
       added to the bar's height instead of eating into it. */
    padding-block-start: env(safe-area-inset-top, 0px);
    box-sizing: content-box;
    background-image: linear-gradient(var(--c-chrome-top), var(--c-chrome-bottom));
    border-block-end: 1px solid var(--c-chrome-hairline);
    box-shadow: 0 2px 8px var(--c-chrome-shadow);
    z-index: var(--z-chrome);
}

.navbar__slot {
    display: flex;
    align-items: center;
    padding-inline: var(--space-2);
}

.navbar__slot--end {
    justify-content: flex-end;
}

.navbar__wordmark {
    /* Tight tracking here, wide tracking on the footer labels: that contrast
       is the whole type treatment. */
    font-size: 1.0625rem;
    font-weight: 500;
    letter-spacing: var(--tracking-tight);
    text-align: center;
    color: var(--c-text);
}
</style>
