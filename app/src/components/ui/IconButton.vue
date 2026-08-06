<script setup lang="ts">
// A square, icon-only button. The icon comes in through the default slot as
// an unplugin-icons SVG component, so this file imports no icons itself.
//
// `label` is REQUIRED, and that is the whole point: an icon-only control with
// no accessible name is invisible to a screen reader, and the old app shipped
// three of them (back, sign-out, footer tabs). Vue dev-warns on a missing
// required prop, and vue-tsc rejects it at build time.

withDefaults(
    defineProps<{
        /** Accessible name. Also the title tooltip on pointer devices. */
        label: string;
        /** 'bare' drops the raised chrome — used inside the footer bar. */
        variant?: 'raised' | 'bare';
    }>(),
    { variant: 'raised' },
);
</script>

<template>
    <button
        type="button"
        class="icon-button pressable"
        :class="`icon-button--${variant}`"
        :aria-label="label"
        :title="label"
    >
        <span class="icon-button__glyph" aria-hidden="true">
            <slot />
        </span>
    </button>
</template>

<style scoped>
.icon-button {
    display: inline-grid;
    place-items: center;
    /* 40px was the old .btn-navbar height; it is also the smallest tap
       target that still feels reliable on a wall-mounted tablet. */
    inline-size: 40px;
    block-size: 40px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--c-text);
    cursor: pointer;
    border-radius: var(--radius-sm);
}

.icon-button--raised {
    /* The old .btn-navbar, minus the inset highlight and text-shadow that
       only existed to fake a bevel under a 2012 gradient. */
    background: var(--c-surface-raised);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}

.icon-button--raised:hover {
    background: #303030;
    color: var(--c-accent);
}

.icon-button--bare:hover {
    color: var(--c-accent);
}

.icon-button__glyph {
    display: flex;
    font-size: 1.25rem;
    line-height: 0;
}
</style>
