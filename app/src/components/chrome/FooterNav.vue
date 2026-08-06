<script setup lang="ts">
// Bottom chrome: the three sections, and THE signature element — a band of
// cyan light that travels to the active tab.
//
// The background artwork is a horizontal band of light across a dark carbon
// texture; this is that same band, focused down to one third of the width.
// It also settles an old debt: the previous app swapped in
// `button_home_glow.png` when `$state.includes('home')` was true, but
// `$state` was never put on the scope, so the active tab NEVER lit up. Here
// the highlight is one CSS element positioned from the route, and the specs
// assert it follows navigation.
//
// Active-section (not active-route) semantics: /home/3 lights the Home tab.
// That is why the links render in `custom` mode instead of relying on
// vue-router's own `router-link-active` class — the same computed index
// drives the class, `aria-current` and the light's transform.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import IconCctv from '~icons/mdi/cctv';
import IconHome from '~icons/mdi/home-variant';
import IconSpeaker from '~icons/mdi/speaker';

const { t } = useI18n();
const route = useRoute();

const tabs = [
    { key: 'home', to: '/home', icon: IconHome },
    { key: 'audio', to: '/audio', icon: IconSpeaker },
    { key: 'security', to: '/security', icon: IconCctv },
] as const;

/** Index of the section containing the current route; -1 when outside all. */
const activeIndex = computed(() =>
    tabs.findIndex((tab) => route.path === tab.to || route.path.startsWith(`${tab.to}/`)),
);
</script>

<template>
    <nav class="footer-nav fade-in-up" :aria-label="t('chrome.sections')">
        <span
            class="footer-nav__light"
            :class="{ 'footer-nav__light--off': activeIndex < 0 }"
            :style="{ '--tab-index': Math.max(activeIndex, 0) }"
            aria-hidden="true"
        />

        <RouterLink
            v-for="(tab, index) in tabs"
            :key="tab.key"
            v-slot="{ href, navigate }"
            :to="tab.to"
            custom
        >
            <a
                :href="href"
                class="footer-nav__tab pressable"
                :class="{ 'footer-nav__tab--active': index === activeIndex }"
                :aria-current="index === activeIndex ? 'page' : undefined"
                @click="navigate"
            >
                <component :is="tab.icon" class="footer-nav__icon" aria-hidden="true" />
                <span class="footer-nav__label">{{ t(`chrome.tabs.${tab.key}`) }}</span>
            </a>
        </RouterLink>
    </nav>
</template>

<style scoped>
.footer-nav {
    position: relative;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    block-size: var(--h-footer);
    /* content-box (overriding the global border-box) so the home-indicator
       inset is added below the tabs instead of shrinking them. */
    padding-block-end: env(safe-area-inset-bottom, 0px);
    box-sizing: content-box;
    background-image: linear-gradient(rgba(12, 12, 12, 0.94), rgba(0, 0, 0, 0.98));
    border-block-start: 1px solid var(--c-chrome-hairline);
    z-index: var(--z-chrome);
}

/* 78px of a small phone's viewport for three tabs is greedy; the old app had
   no responsive behaviour at all and simply cropped. */
@media (max-height: 600px), (max-width: 479px) {
    .footer-nav {
        --h-footer: 64px;
    }
}

.footer-nav__tab {
    display: grid;
    grid-template-rows: 1fr auto;
    place-items: center;
    gap: var(--space-1);
    padding-block: var(--space-3) var(--space-2);
    color: var(--c-text-muted);
    text-decoration: none;
    transition:
        color 200ms ease,
        transform var(--press-duration) ease;
}

.footer-nav__tab--active {
    color: var(--c-accent);
}

.footer-nav__icon {
    font-size: 1.5rem;
    filter: drop-shadow(0 0 0 transparent);
    transition: filter 260ms ease;
}

.footer-nav__tab--active .footer-nav__icon {
    filter: drop-shadow(0 0 7px var(--c-accent-glow));
}

.footer-nav__label {
    /* Wide, uppercase, small: instrument-panel labelling. The counterpart to
       the navbar wordmark's tight tracking. */
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    line-height: 1;
}

/* ---- the travelling light ------------------------------------------- */

.footer-nav__light {
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 0;
    inline-size: calc(100% / 3);
    block-size: 100%;
    transform: translateX(calc(var(--tab-index) * 100%));
    transition:
        transform 380ms cubic-bezier(0.22, 0.61, 0.36, 1),
        opacity 220ms ease;
    pointer-events: none;
}

.footer-nav__light--off {
    opacity: 0;
}

/* The filament: a 2px line sitting on the footer's top edge. */
.footer-nav__light::before {
    content: '';
    position: absolute;
    inset-block-start: -1px;
    inset-inline: 18%;
    block-size: 2px;
    background-image: linear-gradient(
        90deg,
        transparent,
        var(--c-accent) 30%,
        var(--c-accent) 70%,
        transparent
    );
    box-shadow: 0 0 12px var(--c-accent-glow);
}

/* …and its spill into the bar, which is what the old glow PNGs were faking. */
.footer-nav__light::after {
    content: '';
    position: absolute;
    inset-block-start: 0;
    inset-inline: 0;
    block-size: 70%;
    background-image: radial-gradient(
        ellipse 60% 100% at 50% 0%,
        var(--c-accent-glow),
        transparent 70%
    );
    opacity: 0.55;
}

@media (prefers-reduced-motion: reduce) {
    .footer-nav__light,
    .footer-nav__tab,
    .footer-nav__icon {
        transition: none;
    }
}
</style>
