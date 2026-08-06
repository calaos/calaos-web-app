<script setup lang="ts">
// Security: every camera in the house, live.
//
// Identity kept from the old app (src/views/cameralist.html): a bordered
// picture with its name above it, and the whole thing opens the camera.
//
// Composition changed, the same way the room grid changed:
//
//  - The old controller chunked the cameras into rows of three in JavaScript
//    (`cameraSortedByRow`) and floated `.col-1-3` blocks, with the frame drawn
//    by a fixed 218×172 bitmap. Three columns on a phone, three on a wall
//    panel, and a picture stretched into 182×136 whatever its real shape. This
//    is one CSS grid with `auto-fill` and frames that scale: one column on a
//    phone, four on a panel, no bitmaps.
//  - The tile is the room tile's sibling — same surface, same border, same
//    band of light along the bottom edge when a finger is on it — because it
//    is the same kind of object: a thing you press to open a screen. What is
//    inside it is different, so the tile leads with the name (the old layout's
//    `<h3>` above the frame) and gives everything else to the picture.
//
// Every tile polls on its own (components/camera/CameraFrame.vue). The order
// is the store's, which is the order the server sent — `cameraId` is the index
// in that list and the /security/:cameraId route param.

import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import CameraFrame from '../components/camera/CameraFrame.vue';
import { useHomeStore } from '../stores/home';

const { t } = useI18n();
const home = useHomeStore();
</script>

<template>
    <div class="cameras">
        <!-- Named for assistive tech only, like the room grid: the pictures
             say what this screen is far better than a heading could. -->
        <h1 class="visually-hidden">{{ t('camera.title') }}</h1>

        <ul v-if="home.cameras.length > 0" class="cameras__grid fade-in">
            <li v-for="camera in home.cameras" :key="camera.id" class="cameras__cell">
                <RouterLink :to="`/security/${camera.cameraId}`" class="camera-tile pressable">
                    <span class="camera-tile__name">{{ camera.name }}</span>
                    <CameraFrame :camera="camera" />
                </RouterLink>
            </li>
        </ul>

        <p v-else class="cameras__empty fade-in">
            <span class="cameras__empty-title">{{ t('camera.empty') }}</span>
            <span class="cameras__empty-hint">{{ t('camera.emptyHint') }}</span>
        </p>
    </div>
</template>

<style scoped>
.cameras {
    display: flex;
    flex-direction: column;
    /* Fills the shell's content row (App.vue owns the scrolling). */
    min-block-size: 100%;
    padding: var(--space-4);
}

.cameras__grid {
    display: grid;
    /* Wider tracks than the room grid's 9.5rem: a room tile holds two words,
       a camera tile holds a picture, and a picture that small is not a
       picture. One column on a phone, two on a tablet, four on a panel.
       `auto-fit` for the same reason as the room grid: a two-camera house
       left auto-fill holding empty tracks in the corner of a wall panel. The
       ceiling that stops the two real ones inflating into posters lives on
       the tile, not here — a length in the `max` slot would make auto-fit
       count repetitions from it and drop a 768px tablet to one per row. */
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
    gap: var(--space-3);
}

@media (min-width: 480px) {
    .cameras {
        padding: var(--space-6);
    }

    .cameras__grid {
        gap: var(--space-4);
    }
}

.cameras__cell {
    display: flex;
    /* See the room grid: the tile's ceiling, centred in its track. */
    justify-content: center;
}

/* ---- tile -------------------------------------------------------------- */

.camera-tile {
    position: relative;
    display: grid;
    grid-template-rows: auto 1fr;
    gap: var(--space-3);
    inline-size: 100%;
    /* Past this a "live picture from the front door" is a poster of the
       front door. The old screen's bezel was 680px; this is close to it. */
    max-inline-size: 30rem;
    padding: var(--space-3);
    background-color: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    color: var(--c-text);
    text-decoration: none;
    transition:
        background-color 200ms ease,
        border-color 200ms ease,
        transform var(--press-duration) ease;
}

.camera-tile:hover,
.camera-tile:focus-visible {
    background-color: var(--c-surface-raised);
    border-color: #3a3a3a;
}

.camera-tile__name {
    font-size: 1.0625rem;
    font-weight: 500;
    letter-spacing: var(--tracking-tight);
    line-height: 1.2;
    /* Server-provided names can be anything, including one long word. */
    min-inline-size: 0;
    overflow-wrap: anywhere;
}

/* ---- filament: the room tile's band of light, unchanged ---------------- */

.camera-tile::after {
    content: '';
    position: absolute;
    inset-block-end: 0;
    inset-inline: 12%;
    block-size: 2px;
    background-image: linear-gradient(
        90deg,
        transparent,
        var(--c-accent) 30%,
        var(--c-accent) 70%,
        transparent
    );
    box-shadow: 0 0 12px var(--c-accent-glow);
    transform: scaleX(0);
    opacity: 0;
    transition:
        transform 260ms cubic-bezier(0.22, 0.61, 0.36, 1),
        opacity 200ms ease;
    pointer-events: none;
}

.camera-tile:hover::after,
.camera-tile:focus-visible::after,
.camera-tile:active::after {
    transform: scaleX(1);
    opacity: 1;
}

/* The tile itself is `.pressable`, which animations.css already silences; a
   pseudo-element is not, so the band of light has to be named here. It still
   appears on hover and focus — it just arrives instead of sliding open. */
@media (prefers-reduced-motion: reduce) {
    .camera-tile,
    .camera-tile::after {
        transition: none;
    }
}

/* ---- no cameras -------------------------------------------------------- */

.cameras__empty {
    /* `margin: auto` in a flex column, not `place-items: center`: centring
       never puts content out of reach when the viewport is short. */
    margin: auto;
    display: grid;
    gap: var(--space-2);
    max-inline-size: 26rem;
    text-align: center;
}

.cameras__empty-title {
    font-size: 1.125rem;
    color: var(--c-text);
}

.cameras__empty-hint {
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--c-text-muted);
}
</style>
