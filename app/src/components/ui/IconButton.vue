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
    /* 44px, the app's floor for anything a finger aims at (WCAG 2.5.5, and
       the same figure the login and dialog buttons use). The old .btn-navbar
       was 40px; four pixels is the difference between a button you hit and a
       button you hit again. */
    inline-size: 44px;
    block-size: 44px;
    /* Never shrink: this button IS its tap target, and a flex parent that is
       one pixel short must give somewhere else. */
    flex: none;
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
