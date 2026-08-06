<script setup lang="ts">
// The shell: a fixed-height grid of chrome bands around one scrolling
// content area.
//
// The chrome is mounted with v-if rather than kept in the DOM at opacity 0
// and revealed with a class (the old `ng-class="{fadeInDown: isAuth()}"`
// trick). Mounting is what makes the entrance animation replay on every
// sign-in, and it means the login screen genuinely owns the whole viewport
// instead of relying on a `.content-max` override.

import AppBackground from './components/chrome/AppBackground.vue';
import ConnectionBanner from './components/chrome/ConnectionBanner.vue';
import FooterNav from './components/chrome/FooterNav.vue';
import NavBar from './components/chrome/NavBar.vue';
import { useAuthStore } from './stores/auth';

const auth = useAuthStore();
</script>

<template>
    <AppBackground />

    <div class="app-shell">
        <NavBar v-if="auth.isAuthed" />
        <ConnectionBanner />

        <main class="app-shell__content">
            <RouterView />
        </main>

        <FooterNav v-if="auth.isAuthed" />
    </div>
</template>

<style scoped>
.app-shell {
    /* Column flex, NOT a four-row grid: navbar, banner and footer are all
       `v-if`, so the number of bands varies from one to four. A grid keyed to
       row POSITIONS (`auto auto 1fr auto`) hands the 1fr row to whichever
       child happens to land in it — with the banner absent (its normal state)
       that was the footer, which parked itself directly under the content
       with the rest of the viewport empty below it. Flex sizes by role
       instead of by position: the bands take their content height, the
       content area takes everything left. */
    display: flex;
    flex-direction: column;
    /* dvh, not vh: mobile browsers shrink the viewport when their address bar
       is showing, and a footer parked under it is a footer nobody can tap. */
    block-size: 100dvh;
    overflow: hidden;
}

.app-shell__content {
    flex: 1;
    /* A definite height (rather than `auto`), which is what lets a view fill
       it with `min-block-size: 100%` — and what makes THIS the app's only
       scroll container. */
    min-block-size: 0;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
}
</style>
