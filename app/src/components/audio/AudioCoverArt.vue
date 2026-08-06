<script setup lang="ts">
// Album art, and the only place the app renders it — the list tile and the
// player screen show the same picture at two sizes.
//
// It exists as a component rather than markup in the views because every
// player needs its OWN fallback chain (composables/useAudioCover.ts), and a
// composable cannot be called once per item of a `v-for`. One cover, one
// component instance, one chain — the same arrangement CameraFrame uses.
//
// The picture itself:
//
//  - A square well, like the camera's, because artwork is square and a
//    non-square well would letterbox every single cover.
//  - `hero` adds the bleed: a blurred, over-scaled copy of the same image
//    behind the well, so the artwork lights the black panel around it the way
//    a screen lights a dark room. It is the one piece of colour the app ever
//    shows at that size, and it is drawn from the content rather than added
//    on top of it. No artwork, no bleed — the screen stays dark rather than
//    inventing a mood the player is not in.
//  - The placeholder is a glyph in the well, not an apology. A radio stream
//    with no artwork is an ordinary state, not a failure.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import IconMusic from '~icons/mdi/music';
import { useAudioCover } from '../../composables/useAudioCover';
import { useAudioStore } from '../../stores/audio';
import { useAuthStore } from '../../stores/auth';
import type { AudioPlayerItem } from '../../protocol/types';

const props = withDefaults(
    defineProps<{
        player: AudioPlayerItem;
        /** 'hero' = player screen: bigger, and it bleeds. */
        variant?: 'tile' | 'hero';
    }>(),
    { variant: 'tile' },
);

const { t } = useI18n();
const audio = useAudioStore();
const auth = useAuthStore();

// Getters, not values: the player can change under the component (the player
// view is reused across /audio/audio_1 → /audio/audio_2) and the chain
// restarts itself when what it is given changes.
const { src, missing, onError } = useAudioCover(
    () => props.player.id,
    () => audio.coverUrlFor(props.player.id),
    () => ({ user: auth.user, pass: auth.pass }),
    () => audio.coverResolved(props.player.id),
    // A tile is ~4.5rem on screen; asking the server to re-encode a 1200px
    // scan for it would waste a download on both ends.
    { width: props.variant === 'tile' ? 160 : 640 },
);

const showBleed = computed(() => props.variant === 'hero' && src.value !== '' && !missing.value);

// On the player screen the artwork IS the subject, so it is described. On a
// tile it sits next to the player's name and the track's title, and
// describing it again would only make the link's accessible name longer
// without saying anything the reader has not already been told.
const isHero = computed(() => props.variant === 'hero');
</script>

<template>
    <div class="cover" :class="`cover--${variant}`">
        <img
            v-if="showBleed"
            class="cover__bleed"
            :src="src"
            alt=""
            aria-hidden="true"
            decoding="async"
        />

        <div class="cover__well">
            <img
                v-if="src !== ''"
                class="cover__art"
                :src="src"
                :alt="isHero ? t('audio.cover', { name: player.name }) : ''"
                decoding="async"
                @error="onError"
            />
            <IconMusic
                v-else
                class="cover__placeholder"
                :aria-label="isHero ? t('audio.noCover') : undefined"
                :aria-hidden="isHero ? undefined : 'true'"
            />
        </div>
    </div>
</template>

<style scoped>
.cover {
    position: relative;
    inline-size: 100%;
}

/* ---- the bleed --------------------------------------------------------- */

.cover__bleed {
    position: absolute;
    /* Reaches past the well on every side — the light has to spill to read as
       light rather than as a second, softer picture. */
    inset: -12%;
    inline-size: 124%;
    block-size: 124%;
    object-fit: cover;
    filter: blur(2.5rem) saturate(1.6);
    opacity: 0.55;
    /* Behind the well, and out of the way of anything that wants to be
       pressed — it is scenery, not surface. */
    z-index: 0;
    pointer-events: none;
    border-radius: var(--radius-lg);
}

/* ---- the well ---------------------------------------------------------- */

.cover__well {
    position: relative;
    z-index: 1;
    display: grid;
    place-items: center;
    /* Artwork is square; anything else would letterbox every cover. */
    aspect-ratio: 1;
    overflow: hidden;
    /* Deeper than --c-surface: the well is a hole, not a panel sitting on the
       screen. Same reading as the camera's. */
    background-color: #0b0b0b;
    border: 1px solid var(--c-border);
    border-radius: var(--radius-sm);
}

.cover--hero .cover__well {
    border-radius: var(--radius-md);
    box-shadow:
        inset 0 1px 12px rgba(0, 0, 0, 0.85),
        0 18px 44px rgba(0, 0, 0, 0.55);
}

.cover__art {
    display: block;
    inline-size: 100%;
    block-size: 100%;
    object-fit: cover;
}

.cover__placeholder {
    font-size: 1.5rem;
    color: var(--c-text-muted);
    opacity: 0.5;
}

.cover--hero .cover__placeholder {
    font-size: 3.5rem;
}
</style>
