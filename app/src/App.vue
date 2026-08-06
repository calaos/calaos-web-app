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
    display: grid;
    /* navbar · banner · content · footer. The two chrome rows collapse to 0
       when unauthenticated, so the content row takes the whole viewport. */
    grid-template-rows: auto auto 1fr auto;
    /* dvh, not vh: mobile browsers shrink the viewport when their address bar
       is showing, and a footer parked under it is a footer nobody can tap. */
    block-size: 100dvh;
    overflow: hidden;
}

.app-shell__content {
    min-block-size: 0;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
}
</style>
