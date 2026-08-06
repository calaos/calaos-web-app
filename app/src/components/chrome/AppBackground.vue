<script setup lang="ts">
// The fixed backdrop. A real <img> rather than a CSS background-image so the
// fade can hang off the element's own `load` event — decoding a 51 kB PNG is
// fast, but on a cold wall panel the difference between "black flash then
// image" and "image fades up" is the whole first impression.
//
// The old app preloaded 62 images through an assets.json manifest to achieve
// this. That machinery is gone (docs/ARCHITECTURE.md "Styling"): every other
// image in the rewrite is an inlined SVG icon.

import { ref } from 'vue';
import backgroundUrl from '../../assets/background.png';

const loaded = ref(false);
</script>

<template>
    <!-- Decorative: it carries no information, so it stays out of the a11y
         tree and out of the tab order. -->
    <img
        class="app-background"
        :class="{ 'app-background--loaded': loaded }"
        :src="backgroundUrl"
        alt=""
        aria-hidden="true"
        decoding="async"
        @load="loaded = true"
    />
</template>

<style scoped>
.app-background {
    position: fixed;
    inset: 0;
    inline-size: 100%;
    block-size: 100%;
    /* `cover` keeps the artwork's horizontal band of light centred at any
       aspect ratio. The old rule (min-width/min-height, no background-size)
       tiled the 640×910 source and repeated that band down a tall page. */
    object-fit: cover;
    object-position: center;
    z-index: var(--z-background);
    opacity: 0;
    transition: opacity 600ms ease;
    pointer-events: none;
}

.app-background--loaded {
    opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
    .app-background {
        transition: none;
    }
}
</style>
