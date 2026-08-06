<script setup lang="ts">
// One camera, as large as the screen allows.
//
// The old screen (src/views/camera.html) centred a 680×518 bitmap bezel around
// a 640×480 picture — a fixed slab that overflowed a phone sideways and left
// two thirds of a wall panel empty. Here the frame is fluid and capped, the
// name introduces it in the same header shape RoomView uses (plate, eyebrow,
// name, band of light), and the picture is never cropped: on the screen you
// are actually watching, the edges of the scene are the point.
//
// Back is the NavBar's, via `meta.detail` on the route — the same button the
// room detail gets, so nothing here renders one.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import IconCctv from '~icons/mdi/cctv';
import CameraFrame from '../components/camera/CameraFrame.vue';
import { useHomeStore } from '../stores/home';

const { t } = useI18n();
const route = useRoute();
const home = useHomeStore();

// The router guarantees a `\d+` param that is in bounds (bounds check in
// router/index.ts), but the camera can still be missing for a frame: signing
// out empties the store before the navigation to /login completes.
// `cameraId` IS the index in the store's list (stores/home.ts).
const camera = computed(() => home.cameras[Number(route.params.cameraId)]);
</script>

<template>
    <div v-if="camera !== undefined" class="camera">
        <header class="camera__header fade-in-down">
            <span class="camera__plate">
                <IconCctv class="camera__icon" />
            </span>
            <p class="camera__eyebrow">{{ t('camera.label') }}</p>
            <h1 class="camera__name">{{ camera.name }}</h1>
        </header>

        <CameraFrame :camera="camera" variant="single" class="camera__frame fade-in" />
    </div>
</template>

<style scoped>
.camera {
    display: flex;
    flex-direction: column;
    min-block-size: 100%;
    inline-size: 100%;
    /* Roughly the old 640 px picture plus its bezel, but as a ceiling rather
       than a fixed size: a phone gets the full width, a wall panel does not
       get a 1400 px security camera. */
    max-inline-size: 48rem;
    margin-inline: auto;
    padding: var(--space-4);
}

/* ---- header (RoomView's, with a camera in the plate) ------------------- */

.camera__header {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    column-gap: var(--space-4);
    padding-block-end: var(--space-4);
    margin-block-end: var(--space-4);
}

.camera__plate {
    grid-row: span 2;
    display: grid;
    place-items: center;
    inline-size: 3.25rem;
    block-size: 3.25rem;
    background-color: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
}

.camera__icon {
    font-size: 1.75rem;
    color: var(--c-accent);
    filter: drop-shadow(0 0 10px var(--c-accent-glow));
}

.camera__eyebrow {
    /* The grid's micro-type, kept: same size, same tracking, same case. */
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text-muted);
}

.camera__name {
    margin-block-start: var(--space-1);
    font-size: clamp(1.375rem, 5vw, 1.75rem);
    font-weight: 400;
    letter-spacing: var(--tracking-tight);
    line-height: 1.15;
    overflow-wrap: anywhere;
}

/* The camera's band of light. */
.camera__header::after {
    content: '';
    position: absolute;
    inset-block-end: 0;
    inset-inline: 0;
    block-size: 2px;
    background-image: linear-gradient(
        90deg,
        transparent,
        var(--c-accent) 30%,
        var(--c-accent) 70%,
        transparent
    );
    box-shadow: 0 0 12px var(--c-accent-glow);
    pointer-events: none;
}
</style>
