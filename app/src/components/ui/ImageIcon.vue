<script setup lang="ts">
// A bitmap or full-colour SVG used where an icon component is expected.
//
// The app's own glyphs are MDI components that inherit `currentColor`, but
// Calaos ships real ARTWORK for its device states — the amber bulb, the cyan
// outlet, the red boiler (app/src/assets/io/, taken from calaos/calaos_mobile).
// Those carry their own palette and must not be recoloured, so they cannot be
// MDI components; this wraps one in the same 1em box a glyph occupies, so
// `StateIcon` and the row layouts can treat the two interchangeably.
//
// For a MONOCHROME glyph that should follow the text colour, use MaskIcon
// instead — that one paints `currentColor` through the file's alpha.

withDefaults(
    defineProps<{
        src: string;
        /** Empty (the default) marks it decorative, as most row glyphs are. */
        alt?: string;
    }>(),
    { alt: '' },
);
</script>

<template>
    <img
        class="image-icon"
        :src="src"
        :alt="alt"
        :aria-hidden="alt === '' ? 'true' : undefined"
        decoding="async"
    />
</template>

<style scoped>
.image-icon {
    display: block;
    /* Sized in em so it scales with whatever row or plate holds it, exactly
       like the glyph components it stands in for. */
    inline-size: 1em;
    block-size: 1em;
    object-fit: contain;
}
</style>
