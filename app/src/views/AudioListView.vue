<script setup lang="ts">
// Audio: every player in the house, and what each one is doing.
//
// The old screen (src/views/audiolist.html) had the right instinct — cover on
// the left, name and three metadata lines on the right — and no way to fill
// it: it read `audio.current_track` straight off get_home, where that key has
// never existed in any released calaos_server (docs/audio-protocol.md). The
// covers and the track lines were empty on every install. Here the detail
// comes from the get_state the service issues as soon as the house lands, so
// the tile shows what is actually playing.
//
// Composition follows the camera list, deliberately: these are siblings —
// press a tile, open a screen — and a house should not have two different
// grammars for that. What differs is what a player has to say. A camera tile
// leads with its name because the picture speaks for itself; a player tile
// leads with its STATUS, because "is anything playing in the kitchen" is the
// question this screen exists to answer, and it has to be answerable from
// across the room.
//
// Every tile runs its own cover chain (components/audio/AudioCoverArt.vue).
// Players are listed in the order the server sent them; the route param is
// the player's protocol id, not its position, so a deep link survives a house
// that gained a player.

import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import AudioCoverArt from '../components/audio/AudioCoverArt.vue';
import { isPlaying } from '../protocol/audio';
import { useAudioStore } from '../stores/audio';
import { useHomeStore } from '../stores/home';

const { t } = useI18n();
const home = useHomeStore();
const audio = useAudioStore();

/**
 * Status as a word. A player whose detail has not landed yet reads 'unknown',
 * and the tile shows nothing rather than claiming it is stopped.
 */
function statusLabel(id: string): string {
    const { status } = audio.stateFor(id);
    return status === 'unknown' ? '' : t(`audio.status.${status}`);
}

function playing(id: string): boolean {
    return isPlaying(audio.stateFor(id).status);
}
</script>

<template>
    <div class="players">
        <!-- Named for assistive tech only, like the room and camera grids:
             each tile already announces its player, and the h1 is what tells
             a screen reader which of the three screens it is on. -->
        <h1 class="visually-hidden">{{ t('audio.title') }}</h1>

        <ul v-if="home.audioPlayers.length > 0" class="players__grid fade-in">
            <li v-for="player in home.audioPlayers" :key="player.id" class="players__cell">
                <RouterLink :to="`/audio/${player.id}`" class="player-tile pressable">
                    <AudioCoverArt :player="player" class="player-tile__cover" />

                    <div class="player-tile__text">
                        <p class="player-tile__status">
                            <span
                                v-if="playing(player.id)"
                                class="player-tile__dot pulse-soft"
                                aria-hidden="true"
                            />
                            {{ statusLabel(player.id) }}
                        </p>
                        <h2 class="player-tile__name">{{ player.name }}</h2>

                        <!-- Every metadata line is conditional: a radio stream
                             sends four keys, a local file sends a dozen, and a
                             player that has not answered yet sends none. An
                             empty label is worse than no label. -->
                        <p v-if="audio.stateFor(player.id).track.title" class="player-tile__title">
                            {{ audio.stateFor(player.id).track.title }}
                        </p>
                        <p
                            v-if="audio.stateFor(player.id).track.artist"
                            class="player-tile__artist"
                        >
                            {{ audio.stateFor(player.id).track.artist }}
                        </p>
                        <p
                            v-if="
                                audio.stateFor(player.id).known &&
                                audio.stateFor(player.id).track.title === ''
                            "
                            class="player-tile__artist"
                        >
                            {{ t('audio.nothingPlaying') }}
                        </p>
                    </div>
                </RouterLink>
            </li>
        </ul>

        <div v-else class="players__empty fade-in">
            <p class="players__empty-title">{{ t('audio.empty') }}</p>
            <p class="players__empty-hint">{{ t('audio.emptyHint') }}</p>
        </div>
    </div>
</template>

<style scoped>
.players {
    display: flex;
    flex-direction: column;
    /* Fills the shell's content row (App.vue owns scrolling). */
    min-block-size: 100%;
    padding: var(--space-4);
}

.players__grid {
    display: grid;
    /* Wider tracks than the camera grid's 15rem: a tile carries a square
       cover AND four lines of text beside it, and squeezing those into one
       phone column would wrap every title. One column on a phone, two on a
       tablet, three on a wall panel.
       `auto-fit`, as on the other two grids: auto-fill left a two-player
       house parked in the corner of a wall panel behind a row of empty
       tracks. The tile carries the ceiling (a length in the `max` slot would
       make auto-fit count repetitions from it and cost a column). */
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 19rem), 1fr));
    gap: var(--space-3);
}

@media (min-width: 480px) {
    .players {
        padding: var(--space-6);
    }

    .players__grid {
        gap: var(--space-4);
    }
}

.players__cell {
    display: flex;
    /* See the room grid: the tile's ceiling, centred in its track. */
    justify-content: center;
}

/* ---- tile -------------------------------------------------------------- */

.player-tile {
    display: grid;
    grid-template-columns: 4.5rem minmax(0, 1fr);
    align-items: center;
    gap: var(--space-4);
    inline-size: 100%;
    /* Past this the cover and the track title are at opposite ends of the
       tile and stop reading as one thing. */
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

.player-tile:hover,
.player-tile:focus-visible {
    background-color: var(--c-surface-raised);
    border-color: #3a3a3a;
}

.player-tile__text {
    /* Server-provided names and titles can be anything, including one long
       word: this is what lets the ellipsis below actually engage. */
    min-inline-size: 0;
}

.player-tile__status {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    /* The grid's micro-type, unchanged: same size, same tracking, same case
       as every eyebrow in the app. */
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text-muted);
    /* Holds the line even when the status is empty, so tiles in a row do not
       sit at different heights while the first get_state is in flight. */
    min-block-size: 1rem;
}

.player-tile__dot {
    inline-size: 0.375rem;
    block-size: 0.375rem;
    border-radius: 50%;
    background-color: var(--c-accent);
    box-shadow: 0 0 6px var(--c-accent-glow);
}

.player-tile__name {
    margin-block-start: var(--space-1);
    font-size: 1.0625rem;
    font-weight: 500;
    letter-spacing: var(--tracking-tight);
    line-height: 1.2;
    overflow-wrap: anywhere;
}

.player-tile__title,
.player-tile__artist {
    /* One line each. A tile is a glance; the player screen is where the whole
       title gets room. */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.35;
}

.player-tile__title {
    margin-block-start: var(--space-2);
    font-size: 0.875rem;
    color: var(--c-text);
}

.player-tile__artist {
    font-size: 0.8125rem;
    color: var(--c-text-muted);
}

/* `.pressable` already silences the tile's transform under reduced motion;
   naming the tile here covers the colour fades in the same declaration, so
   the rule does not depend on which class happens to win. */
@media (prefers-reduced-motion: reduce) {
    .player-tile {
        transition: none;
    }
}

/* ---- empty ------------------------------------------------------------- */

.players__empty {
    /* `margin: auto` in a flex column, not `place-items: center`: centring
       never puts content out of reach when the viewport is short. */
    margin: auto;
    display: grid;
    gap: var(--space-2);
    max-inline-size: 26rem;
    text-align: center;
}

.players__empty-title {
    font-size: 1.125rem;
    color: var(--c-text);
}

.players__empty-hint {
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--c-text-muted);
}
</style>
