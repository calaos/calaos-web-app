<script setup lang="ts">
// One player, with everything the protocol actually offers.
//
// The old screen (src/views/audio_player.html) laid out the right things —
// cover, four transport buttons, a title — and none of them worked: the
// previous button sent `prev`, which AudioPlayer::set_value does not know; the
// cover and metadata came from get_home, where they have never existed; there
// was no volume control and no position. This one is built against the frames
// calaos_server really answers (docs/audio-protocol.md).
//
// Two decisions shape the layout, and both come from the protocol rather than
// from taste:
//
//  - THERE IS NO SEEK. `AudioPlayer::set_current_time` exists in C++ and no
//    JSON path ever reaches it, so position is read-only for every client.
//    Drawing it as a scrubber — a track with a knob — would promise a gesture
//    that cannot be delivered. It is a filament instead: a 2px hairline in the
//    same gradient as the band of light under every detail header in the app,
//    filling left to right, with the two clock readings outside it. Nothing
//    about it invites a finger.
//  - DURATION IS OFTEN UNKNOWN. Radio streams report `"0"`, and which
//    metadata a real LMS returns is on the spec's unverified list. When there
//    is no duration the filament is not drawn at all — a bar that can never
//    fill is worse than no bar — and the elapsed clock keeps counting on its
//    own, which is exactly what a stream is.
//
// The cover is the one place colour is allowed: it bleeds behind the well
// (components/audio/AudioCoverArt.vue) so the artwork lights the panel. It is
// also the only thing on this screen that is not the app's own palette, which
// is the point — the rest of the layout stays quiet around it.
//
// Position advances locally between anchors; see stores/audio.ts for why it
// is not polled. The 15 s re-anchor below is the drift correction, and it
// doubles as a repair for any event the socket missed.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import IconMusic from '~icons/mdi/music';
import IconPause from '~icons/mdi/pause';
import IconPlay from '~icons/mdi/play';
import IconSkipNext from '~icons/mdi/skip-next';
import IconSkipPrevious from '~icons/mdi/skip-previous';
import IconStop from '~icons/mdi/stop';
import IconVolumeHigh from '~icons/mdi/volume-high';
import IconVolumeOff from '~icons/mdi/volume-off';
import AudioCoverArt from '../components/audio/AudioCoverArt.vue';
import BaseSlider from '../components/ui/BaseSlider.vue';
import IconButton from '../components/ui/IconButton.vue';
import { elapsedAt, formatClock, isPlaying } from '../protocol/audio';
import { useAudioStore } from '../stores/audio';
import { useHomeStore } from '../stores/home';

/** How often the local clock is repainted. Half a second never shows a skipped digit. */
const TICK_MS = 500;
/**
 * How often a playing player is re-anchored with get_state. Long enough that
 * a wall panel left on this screen is not chatty, short enough that local
 * drift never becomes visible against the track's own duration.
 */
const REFRESH_MS = 15_000;

const { t } = useI18n();
const route = useRoute();
const home = useHomeStore();
const audio = useAudioStore();

// The route param is the player's protocol id (`audio_1`), not an index: the
// audio list is not sorted and a house can gain a player, so a position would
// make every bookmark wrong. The router leaves it opaque and unbounded, which
// is why the player can legitimately be missing here — a stale deep link, or
// a sign-out that emptied the store before the route change completed.
const playerId = computed(() => String(route.params.playerId ?? ''));
const player = computed(() => home.audioPlayers.find((item) => item.id === playerId.value));

const state = computed(() => audio.stateFor(playerId.value));
const track = computed(() => state.value.track);
const playing = computed(() => isPlaying(state.value.status));

/** Repainted by the ticker; the ONLY reason this component re-renders on time. */
const now = ref(Date.now());
const elapsed = computed(() => elapsedAt(state.value, now.value));
const duration = computed(() => track.value.duration);
/** 0-100. Only meaningful when a duration is known — see the filament's v-if. */
const progress = computed(() =>
    duration.value > 0 ? Math.min(100, (elapsed.value / duration.value) * 100) : 0,
);

const statusLabel = computed(() =>
    state.value.status === 'unknown' ? '' : t(`audio.status.${state.value.status}`),
);

let tick: ReturnType<typeof setInterval> | null = null;
let refresh: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
    tick = setInterval(() => {
        now.value = Date.now();
    }, TICK_MS);
    refresh = setInterval(() => {
        // Only while it is moving: a paused player's position is already
        // exact, and asking about it would be a frame that changes nothing.
        if (playing.value) audio.requestDetails([playerId.value]);
    }, REFRESH_MS);
});

onBeforeUnmount(() => {
    if (tick !== null) clearInterval(tick);
    if (refresh !== null) clearInterval(refresh);
    tick = null;
    refresh = null;
});

// Arriving on the screen — including switching straight from one player to
// another — asks for fresh detail. The service already fetched every player
// when the house landed, so this is a refresh, not the first read: it is what
// makes a screen opened an hour later show the truth immediately.
watch(
    playerId,
    (id) => {
        if (id !== '') audio.requestDetails([id]);
    },
    { immediate: true },
);

function toggle(): void {
    if (playing.value) audio.pause(playerId.value);
    else audio.play(playerId.value);
}
</script>

<template>
    <div v-if="player !== undefined" class="player">
        <header class="player__header fade-in-down">
            <span class="player__plate">
                <IconMusic class="player__plate-icon" />
            </span>
            <p class="player__eyebrow">
                <span v-if="playing" class="player__dot pulse-soft" aria-hidden="true" />
                {{ statusLabel === '' ? t('audio.label') : statusLabel }}
            </p>
            <h1 class="player__name">{{ player.name }}</h1>
        </header>

        <div class="player__stage fade-in">
            <AudioCoverArt :player="player" variant="hero" class="player__cover" />
        </div>

        <!-- Metadata, each line conditional. What a backend reports depends on
             the medium: a local file carries a dozen LMS tags, a radio stream
             four, and a player that has not answered yet none. -->
        <div class="player__meta fade-in">
            <h2 v-if="track.title !== ''" class="player__track">{{ track.title }}</h2>
            <p v-else class="player__track player__track--idle">{{ t('audio.nothingPlaying') }}</p>
            <p v-if="track.artist !== ''" class="player__artist">{{ track.artist }}</p>
            <p v-if="track.album !== ''" class="player__album">{{ track.album }}</p>
        </div>

        <!-- Position. Read-only by protocol: there is no seek command. -->
        <div v-if="track.title !== ''" class="player__position fade-in">
            <span class="player__clock">{{ formatClock(elapsed) }}</span>
            <div
                v-if="duration > 0"
                class="player__filament"
                role="progressbar"
                :aria-label="t('audio.position', { name: player.name })"
                :aria-valuemin="0"
                :aria-valuemax="Math.round(duration)"
                :aria-valuenow="Math.round(elapsed)"
                :aria-valuetext="formatClock(elapsed)"
            >
                <span class="player__filament-fill" :style="{ inlineSize: `${progress}%` }" />
            </div>
            <!-- A stream has no end to count towards; the gap keeps the
                 elapsed clock where it sits for a track with one. -->
            <span v-else class="player__filament player__filament--open" aria-hidden="true" />
            <span v-if="duration > 0" class="player__clock">{{ formatClock(duration) }}</span>
        </div>

        <!-- Three verbs you use WHILE listening, centred on the one you press
             most; stop is not a peer of those three — it ends the session and
             rewinds — so it sits apart, at the edge, quieter. -->
        <div class="player__transport fade-in-up">
            <IconButton
                variant="bare"
                :label="t('audio.stop', { name: player.name })"
                class="player__step player__stop"
                @click="audio.stop(playerId)"
            >
                <IconStop />
            </IconButton>

            <IconButton
                variant="bare"
                :label="t('audio.previous', { name: player.name })"
                class="player__step"
                @click="audio.previous(playerId)"
            >
                <IconSkipPrevious />
            </IconButton>

            <!-- The one filled control in the app. It earns it: on this screen
                 there is exactly one thing you press. -->
            <button
                type="button"
                class="player__toggle pressable"
                :aria-label="
                    playing
                        ? t('audio.pause', { name: player.name })
                        : t('audio.play', { name: player.name })
                "
                @click="toggle"
            >
                <IconPause v-if="playing" aria-hidden="true" />
                <IconPlay v-else aria-hidden="true" />
            </button>

            <IconButton
                variant="bare"
                :label="t('audio.next', { name: player.name })"
                class="player__step"
                @click="audio.next(playerId)"
            >
                <IconSkipNext />
            </IconButton>
        </div>

        <div class="player__volume fade-in-up">
            <IconVolumeOff v-if="state.volume === 0" class="player__volume-icon" aria-hidden="true" />
            <IconVolumeHigh v-else class="player__volume-icon" aria-hidden="true" />
            <BaseSlider
                :model-value="state.volume"
                :label="t('audio.volume', { name: player.name })"
                @commit="(value) => audio.setVolume(playerId, value)"
            />
            <span class="player__volume-value">{{ t('audio.percent', { value: state.volume }) }}</span>
        </div>
    </div>
</template>

<style scoped>
.player {
    display: flex;
    flex-direction: column;
    min-block-size: 100%;
    /* Narrower than the camera screen's 48rem: a cover is square, and a
       square blown up to 48rem on a wall panel is a poster, not a control. */
    max-inline-size: 30rem;
    margin-inline: auto;
    padding: var(--space-4);
}

/* ---- header (RoomView's, with the player in the plate) ----------------- */

.player__header {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    column-gap: var(--space-4);
    padding-block-end: var(--space-4);
    margin-block-end: var(--space-6);
}

.player__plate {
    grid-row: span 2;
    display: grid;
    place-items: center;
    inline-size: 3.25rem;
    block-size: 3.25rem;
    background-color: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
}

.player__plate-icon {
    font-size: 1.75rem;
    color: var(--c-accent);
    filter: drop-shadow(0 0 10px var(--c-accent-glow));
}

.player__eyebrow {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text-muted);
}

.player__dot {
    inline-size: 0.375rem;
    block-size: 0.375rem;
    border-radius: 50%;
    background-color: var(--c-accent);
    box-shadow: 0 0 6px var(--c-accent-glow);
}

.player__name {
    margin-block-start: var(--space-1);
    font-size: clamp(1.375rem, 5vw, 1.75rem);
    font-weight: 400;
    letter-spacing: var(--tracking-tight);
    line-height: 1.15;
    overflow-wrap: anywhere;
}

/* The header's band of light, as on every detail screen. */
.player__header::after {
    content: '';
    position: absolute;
    inset-block-end: 0;
    inset-inline: 0;
    block-size: 2px;
    background-image: linear-gradient(90deg, transparent, var(--c-accent), transparent);
    opacity: 0.55;
}

/* ---- cover ------------------------------------------------------------- */

.player__stage {
    display: flex;
    justify-content: center;
    margin-block-end: var(--space-6);
}

.player__cover {
    /* Capped rather than fluid to the column: past this the artwork stops
       being a picture of a record and starts being wallpaper. */
    max-inline-size: 18rem;
}

/* ---- metadata ---------------------------------------------------------- */

.player__meta {
    display: grid;
    gap: var(--space-1);
    text-align: center;
    margin-block-end: var(--space-6);
}

.player__track {
    font-size: 1.25rem;
    font-weight: 500;
    letter-spacing: var(--tracking-tight);
    line-height: 1.25;
    overflow-wrap: anywhere;
}

.player__track--idle {
    font-weight: 400;
    color: var(--c-text-muted);
}

.player__artist {
    font-size: 0.9375rem;
    color: var(--c-text);
    overflow-wrap: anywhere;
}

.player__album {
    font-size: 0.8125rem;
    color: var(--c-text-muted);
    overflow-wrap: anywhere;
}

/* ---- position ---------------------------------------------------------- */

.player__position {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-block-end: var(--space-6);
}

.player__clock {
    /* Tabular figures: without them the whole line shifts sideways every time
       a 1 turns into a 4. */
    font-variant-numeric: tabular-nums;
    font-size: 0.75rem;
    color: var(--c-text-muted);
    min-inline-size: 2.5rem;
    text-align: center;
}

.player__filament {
    position: relative;
    flex: 1;
    block-size: 2px;
    border-radius: 1px;
    background-color: var(--c-border);
    overflow: hidden;
}

.player__filament-fill {
    display: block;
    block-size: 100%;
    /* The header's band of light, running the other way: this one has a
       leading edge, because it is going somewhere. */
    background-image: linear-gradient(90deg, transparent, var(--c-accent));
    box-shadow: 0 0 8px var(--c-accent-glow);
    transition: inline-size 500ms linear;
}

/* No duration: the line stays, unlit, so the clock keeps its place. */
.player__filament--open {
    opacity: 0.4;
}

/* ---- transport --------------------------------------------------------- */

.player__transport {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    margin-block-end: var(--space-8);
}

.player__step {
    font-size: 1.5rem;
    color: var(--c-text-muted);
    transition: color 200ms ease;
}

.player__step:hover,
.player__step:focus-visible {
    color: var(--c-text);
}

/* Out of the flow so the trio stays centred on the disc whatever the width,
   and dimmer than its neighbours because it is not one of them. */
.player__stop {
    position: absolute;
    inset-inline-start: 0;
    /* mdi's stop is a small centred square where the skip glyphs fill their
       box; without this it reads as debris rather than as a control. */
    font-size: 1.75rem;
    opacity: 0.7;
}

.player__stop:hover,
.player__stop:focus-visible {
    opacity: 1;
}

.player__toggle {
    display: grid;
    place-items: center;
    inline-size: 4rem;
    block-size: 4rem;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background-color: var(--c-accent);
    /* The accent's own glow, at the size the accent is used here. */
    box-shadow: 0 0 24px var(--c-accent-glow);
    color: #06222b;
    font-size: 2rem;
    cursor: pointer;
    transition:
        filter 200ms ease,
        transform var(--press-duration) ease;
}

.player__toggle:hover,
.player__toggle:focus-visible {
    filter: brightness(1.12);
}

/* ---- volume ------------------------------------------------------------ */

.player__volume {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background-color: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
}

.player__volume-icon {
    font-size: 1.25rem;
    color: var(--c-text-muted);
}

.player__volume-value {
    font-variant-numeric: tabular-nums;
    font-size: 0.8125rem;
    color: var(--c-text-muted);
    min-inline-size: 2.75rem;
    text-align: end;
}

/*
 * Short viewport — a phone in portrait, or a 768px laptop window.
 *
 * The same six blocks have to fit into less height, and the artwork is the
 * only one that can give ground: the transport and the volume are why this
 * screen exists, and on a 360×780 phone the volume panel used to sit under
 * the footer with nothing on screen to suggest it was there at all.
 *
 * Last in the file because these selectors are no more specific than the ones
 * they override — a media query does not add specificity, only source order
 * decides.
 */
@media (max-height: 800px) {
    .player__cover {
        max-inline-size: 13rem;
    }

    .player__stage,
    .player__meta,
    .player__position {
        margin-block-end: var(--space-4);
    }

    .player__transport {
        margin-block-end: var(--space-6);
    }
}

/* The filament is the one thing on this screen that MOVES on its own — it
   creeps for the length of a track, every 500 ms, whether or not anyone is
   touching the page. Under reduced motion it jumps to the new position
   instead. The transport's own fades follow, so the whole screen answers the
   preference in one place. */
@media (prefers-reduced-motion: reduce) {
    .player__filament-fill,
    .player__step,
    .player__toggle {
        transition: none;
    }
}
</style>
