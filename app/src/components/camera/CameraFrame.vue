<script setup lang="ts">
// One camera's picture, in its frame — the only place the app renders a
// snapshot, used by both the list and the single-camera view.
//
// It exists as a component rather than as markup inside the views because
// every camera needs its OWN poll (composables/useCameraPoll.ts), and a
// composable cannot be called once per item of a `v-for`. One frame, one
// component instance, one chain.
//
// The frame itself:
//
//  - The old app drew a bitmap picture frame around every camera
//    (camera_border.png, 218×172 with the picture inset by 18 px, and a second
//    680×518 bitmap for the single view). Both were fixed-size, which is why
//    the picture was stretched into 182×136 regardless of what the camera
//    actually sent. Here the bezel is CSS — a hairline, a dark well and an
//    inner shadow — so it holds any width, and `aspect-ratio` keeps the
//    picture's shape instead of squashing it.
//  - `cover` on a tile (a thumbnail may be cropped), `contain` on the single
//    view (the screen you are actually watching must not lose its edges).
//  - The LIVE badge is the design system's eyebrow type (uppercase micro-type,
//    wide tracking — see HomeView's room type and RoomView's header) laid over
//    the picture with a scrim, plus the connection banner's breathing dot in
//    accent cyan. It appears only while frames are arriving, so it never
//    claims a dead camera is live.
//  - When the camera is down the picture is BLANKED rather than left on
//    screen dimmed: a stale frame from a security camera is worse than no
//    frame. The `<img>` stays mounted (transparent, still polling) so the
//    picture returns by itself when the camera does.
//
// The retry button is offered on the single view only: on a tile the frame
// lives inside the `RouterLink` that opens the camera, and a button inside an
// anchor is invalid, unfocusable-in-the-right-order markup. The tile still
// recovers on its own — the chain never stops.

import { useI18n } from 'vue-i18n';
import IconCctv from '~icons/mdi/cctv';
import IconCctvOff from '~icons/mdi/cctv-off';
import { useCameraPoll } from '../../composables/useCameraPoll';
import { cameraSnapshotUrl } from '../../services/camera-url';
import { useAuthStore } from '../../stores/auth';
import type { CameraItem } from '../../protocol/types';

const props = withDefaults(
    defineProps<{
        camera: CameraItem;
        /** 'single' = the detail screen: bigger frame, uncropped, retryable. */
        variant?: 'tile' | 'single';
    }>(),
    { variant: 'tile' },
);

const { t } = useI18n();
const auth = useAuthStore();

// A getter, not a value: the credentials live in the store and the camera can
// change under the component (/security/0 → /security/1 reuses the view), and
// the poll restarts itself when the URL it is given changes.
const { src, error, loaded, onLoad, onError, retry } = useCameraPoll(() =>
    cameraSnapshotUrl(props.camera.id, { user: auth.user, pass: auth.pass }),
);
</script>

<template>
    <div class="camera-frame" :class="`camera-frame--${variant}`">
        <div class="camera-frame__well">
            <img
                v-if="src !== ''"
                class="camera-frame__picture"
                :class="{ 'camera-frame__picture--blank': !loaded || error }"
                :src="src"
                :alt="t('camera.snapshot', { name: camera.name })"
                decoding="async"
                @load="onLoad"
                @error="onError"
            />

            <span v-if="loaded && !error" class="camera-frame__live">
                <span class="camera-frame__dot pulse-soft" aria-hidden="true" />
                {{ t('camera.live') }}
            </span>

            <div v-if="!loaded && !error" class="camera-frame__state">
                <IconCctv class="camera-frame__glyph" aria-hidden="true" />
            </div>

            <div v-if="error" class="camera-frame__state camera-frame__state--down" role="status">
                <IconCctvOff class="camera-frame__glyph" aria-hidden="true" />
                <p class="camera-frame__message">{{ t('camera.unavailable') }}</p>
                <button
                    v-if="variant === 'single'"
                    type="button"
                    class="camera-frame__retry pressable"
                    @click="retry"
                >
                    {{ t('camera.retry') }}
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.camera-frame {
    inline-size: 100%;
}

.camera-frame__well {
    position: relative;
    /* 4:3 — what the calaos camera proxy sends today, and what the old bitmap
       bezels were cut for. A 16:9 camera letterboxes inside it rather than
       reshaping the grid row by row. */
    aspect-ratio: 4 / 3;
    overflow: hidden;
    /* Deeper than --c-surface: the well is a hole in the tile, not a panel
       sitting on it. */
    background-color: #0b0b0b;
    border: 1px solid var(--c-border);
    border-radius: var(--radius-sm);
    box-shadow: inset 0 1px 10px rgba(0, 0, 0, 0.9);
}

.camera-frame--single .camera-frame__well {
    border-radius: var(--radius-md);
    box-shadow:
        inset 0 1px 14px rgba(0, 0, 0, 0.9),
        0 14px 34px rgba(0, 0, 0, 0.5);
}

.camera-frame__picture {
    display: block;
    inline-size: 100%;
    block-size: 100%;
    object-fit: cover;
    transition: opacity 200ms ease;
}

.camera-frame--single .camera-frame__picture {
    object-fit: contain;
}

.camera-frame__picture--blank {
    /* NOT display:none — a hidden image still loads, a removed one stops the
       chain that would bring the camera back. */
    opacity: 0;
}

/* ---- live badge -------------------------------------------------------- */

.camera-frame__live {
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3) var(--space-3) var(--space-3);
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text);
    /* A scrim: the corner of a camera picture is as likely to be a white sky
       as a dark hallway. */
    background-image: linear-gradient(150deg, rgba(0, 0, 0, 0.75), transparent 85%);
    pointer-events: none;
}

.camera-frame__dot {
    inline-size: 0.4rem;
    block-size: 0.4rem;
    border-radius: 50%;
    background-color: var(--c-accent);
    box-shadow: 0 0 8px var(--c-accent-glow);
}

/* ---- waiting / down ---------------------------------------------------- */

.camera-frame__state {
    position: absolute;
    inset: 0;
    display: grid;
    align-content: center;
    justify-items: center;
    gap: var(--space-3);
    padding: var(--space-4);
    text-align: center;
}

.camera-frame__glyph {
    font-size: 1.75rem;
    color: var(--c-text-muted);
    opacity: 0.45;
}

.camera-frame__state--down .camera-frame__glyph {
    /* Amber, like the connection banner: degraded, not broken forever. */
    color: var(--c-warn);
    opacity: 0.9;
}

.camera-frame__message {
    font-size: 0.8125rem;
    line-height: 1.3;
    color: var(--c-text-muted);
}

.camera-frame__retry {
    min-block-size: 2.25rem;
    padding: var(--space-2) var(--space-4);
    background-color: var(--c-surface-raised);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-sm);
    color: var(--c-text);
    font-size: 0.875rem;
    cursor: pointer;
    transition:
        color 200ms ease,
        border-color 200ms ease,
        transform var(--press-duration) ease;
}

.camera-frame__retry:hover,
.camera-frame__retry:focus-visible {
    color: var(--c-accent);
    border-color: var(--c-accent);
}
</style>
