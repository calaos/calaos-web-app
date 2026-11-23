<script setup lang="ts">
// The fixed backdrop, mounted once under the shell. The PNGs are static files
// in public/ because a bundled import.meta.url no longer points next to them;
// BASE_URL keeps them under the `/app/` prefix (vite `base: './'`); it is relative
// to document.baseURI, which stays put because the router is hash-based.

import { onMounted, onUnmounted, ref } from 'vue';
import '../../background/web/calaos-bg.css';
import { mountBackground } from '../../background/web/calaos-bg.mjs';

const el = ref<HTMLElement | null>(null);
let unmount: (() => void) | undefined;

onMounted(() => {
    // Without ResizeObserver the layer could never follow a resize: keep the plain page.
    if (el.value && typeof ResizeObserver !== 'undefined') unmount = mountBackground(el.value, { assetsUrl: `${import.meta.env.BASE_URL}calaos-bg/` });
});
onUnmounted(() => unmount?.());
</script>

<template>
    <!-- Decorative, and empty: the dot layers are appended to it. -->
    <div id="calaos-bg" ref="el" class="app-background" aria-hidden="true"></div>
</template>

<style scoped>
.app-background {
    position: fixed;
    inset: 0;
    z-index: var(--z-background);
    pointer-events: none;
}
</style>
