<script setup lang="ts">
// A monochrome SVG painted in `currentColor`.
//
// Calaos's action glyphs (app/src/assets/io/ic_outlet_on.svg and friends, from
// calaos/calaos_mobile) are solid black shapes. calaos_mobile paints them by
// stacking a `ColorOverlay` over the image; the web equivalent is a mask — the
// element is a block of `currentColor` and the file supplies the alpha. That
// keeps them doing what every other icon in this app does: inherit the colour
// and the size of the thing that holds them, hover states and all.
//
// An `<img>` would freeze them black, and `filter: invert()` would only ever
// give white. This gives the real colour, in both themes.

import { computed } from 'vue';

const props = defineProps<{
    /** Resolved URL of a monochrome SVG. */
    src: string;
}>();

/**
 * The URL is QUOTED on purpose. Vite inlines a small SVG as a `data:` URI, and
 * an unquoted `url()` ends at the first comma or parenthesis inside it — the
 * mask then fails to load and the element paints as a solid block of
 * `currentColor`, which is exactly what a broken button looks like.
 */
const maskImage = computed(() => `url("${props.src}")`);
</script>

<template>
    <span class="mask-icon" aria-hidden="true" :style="{ '--mask-icon-src': maskImage }" />
</template>

<style scoped>
.mask-icon {
    display: block;
    inline-size: 1em;
    block-size: 1em;
    background-color: currentColor;
    -webkit-mask-image: var(--mask-icon-src);
    mask-image: var(--mask-icon-src);
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-position: center;
    mask-position: center;
    -webkit-mask-size: contain;
    mask-size: contain;
}
</style>
