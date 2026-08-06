<script setup lang="ts">
// The house: every room as a tile, most-used first.
//
// Identity kept from the old app (src/views/home.html): a room is a plate
// carrying its name and a glyph for its type, with the temperature clipped to
// the corner of the ones that measure it.
//
// Composition and layout changed:
//
//  - The old controller chunked the room list into rows of three in
//    JavaScript (`homeByRow`) and floated `.col-1-3` blocks, so the grid was
//    three columns on a 320 px phone and three columns on a 1600 px screen.
//    This is one CSS grid with `auto-fill`, which fits the tiles to whatever
//    width it is given — two on a phone, six on a wall panel.
//  - The tile is left-aligned like the login form rather than centred: the
//    name is the thing being scanned, and names align on a column. Its type
//    sits above it in the same wide uppercase micro-type the footer tabs use
//    (the label NAMES the glyph next to the name — it is also why an
//    unrecognized type is worth a real translated word rather than nothing).
//  - Accent: the glyph is the only colour on a resting tile, held at low
//    opacity; touching the tile lights it and draws the filament along the
//    bottom edge — the same band of light as the footer's active tab and the
//    login screen's focused field. Light follows the finger, everywhere.
//
// Ordering is the store's (`rooms` is sorted by `hits` desc at ingest, as the
// old app did), so this view never sorts.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import IconThermometer from '~icons/mdi/thermometer';
import RoomIcon, { roomTypeLabelKey } from '../components/ui/RoomIcon.vue';
import { parseTemp } from '../protocol/io-states';
import { useHomeStore } from '../stores/home';
import type { RoomVM } from '../stores/home';

const { t } = useI18n();
const home = useHomeStore();

/**
 * The room's temperature, ready to render — null when the room has no temp IO
 * (or has one it was told not to show).
 *
 * The old tile hardcoded `°C`; `parseTemp` uses the server's unit when it
 * sends one and falls back to `°C`. The `visible` check is new: the old app
 * set `hasTemp` from the raw item list, so a temperature the server had
 * marked invisible still showed up here.
 */
function temperature(room: RoomVM): string | null {
    if (room.tempIoId === null) return null;
    const io = home.getIo(room.tempIoId);
    if (io === undefined || !io.visible) return null;
    return parseTemp(io.state, io.unit).display;
}

/** One entry per tile, in the store's order — which is `hits` desc. */
const tiles = computed(() =>
    home.rooms.map((room) => ({
        room,
        typeLabel: roomTypeLabelKey(room.type),
        temperature: temperature(room),
    })),
);
</script>

<template>
    <div class="home">
        <!-- The screen names itself for assistive tech only: on screen the
             tiles are self-evidently the house, and a "Rooms" banner over
             them would be a label with nothing to label. -->
        <h1 class="visually-hidden">{{ t('home.title') }}</h1>

        <ul v-if="tiles.length > 0" class="home__grid fade-in">
            <li v-for="tile in tiles" :key="tile.room.roomId" class="home__cell">
                <RouterLink :to="`/home/${tile.room.roomId}`" class="room-tile pressable">
                    <span class="room-tile__head">
                        <span class="room-tile__type">{{ t(tile.typeLabel) }}</span>
                        <span v-if="tile.temperature !== null" class="room-tile__temp">
                            <IconThermometer
                                class="room-tile__temp-icon"
                                role="img"
                                :aria-label="t('home.temperature')"
                            />
                            {{ tile.temperature }}
                        </span>
                    </span>

                    <span class="room-tile__body">
                        <RoomIcon :type="tile.room.type" class="room-tile__icon" />
                        <span class="room-tile__name">{{ tile.room.name }}</span>
                    </span>
                </RouterLink>
            </li>
        </ul>

        <p v-else class="home__empty fade-in">
            <span class="home__empty-title">{{ t('home.empty') }}</span>
            <span class="home__empty-hint">{{ t('home.emptyHint') }}</span>
        </p>
    </div>
</template>

<style scoped>
.home {
    display: flex;
    flex-direction: column;
    /* Fills the shell's content row (App.vue owns the scrolling), rather than
       declaring a viewport height of its own. */
    min-block-size: 100%;
    padding: var(--space-4);
}

.home__grid {
    /* Replaces the old controller's 3-per-row chunking: the browser decides
       how many tiles fit, down to two on a 412 px phone.
       `auto-fit`, not `auto-fill`: a four-room house on a wall panel left
       auto-fill holding four EMPTY tracks, so the whole house sat in the top
       left corner of a 1280px screen with two thirds of it blank. auto-fit
       collapses the empty ones and the real tiles share the width.
       The max stays `1fr` on purpose: with a length there, auto-fit counts
       repetitions from the MAX, and a 14rem ceiling silently dropped a phone
       to one column and a tablet to one camera per row. The ceiling belongs
       on the tile (below), where it costs nothing. */
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 9.5rem), 1fr));
    gap: var(--space-3);
    /* A room grid stretched across a 27" screen is a scavenger hunt. */
    inline-size: 100%;
    max-inline-size: 76rem;
    margin-inline: auto;
}

@media (min-width: 480px) {
    .home {
        padding: var(--space-6);
    }

    .home__grid {
        gap: var(--space-4);
    }
}

.home__cell {
    display: flex;
    /* Where the tile's ceiling is spent: a two-room house on a wall panel
       gets two tiles the size of a tile, centred in their tracks, rather
       than two 600px slabs each holding one word. */
    justify-content: center;
}

/* ---- the tile --------------------------------------------------------- */

.room-tile {
    position: relative;
    display: grid;
    grid-template-rows: auto 1fr;
    gap: var(--space-3);
    inline-size: 100%;
    max-inline-size: 22rem;
    min-block-size: 7rem;
    padding: var(--space-3);
    /* First claim on the surface tokens: the login screen deliberately has no
       card, but a room IS an object you press, and it needs an edge. */
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

.room-tile:hover,
.room-tile:focus-visible {
    background-color: var(--c-surface-raised);
    border-color: #3a3a3a;
}

.room-tile__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
}

.room-tile__type {
    /* The footer tabs' type: small, wide, uppercase. Applied by CSS so the
       catalogue keeps sentence-case strings. */
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text-muted);
    /* Long labels shorten rather than push the temperature off the tile. */
    min-inline-size: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.room-tile__temp {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex: none;
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
    color: var(--c-text);
    white-space: nowrap;
}

.room-tile__temp-icon {
    font-size: 0.875rem;
    color: var(--c-text-muted);
}

.room-tile__body {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    /* Name and glyph sit on the tile's floor, so tiles in a row line up
       whether or not a name wraps. */
    align-self: end;
    min-inline-size: 0;
}

.room-tile__icon {
    flex: none;
    font-size: 1.75rem;
    /* The one colour on a resting tile, dimmed until it is touched — the old
       app's cyan room names, moved onto the glyph. */
    color: var(--c-accent);
    opacity: 0.55;
    transition:
        opacity 200ms ease,
        filter 260ms ease;
    filter: drop-shadow(0 0 0 transparent);
}

.room-tile:hover .room-tile__icon,
.room-tile:focus-visible .room-tile__icon,
.room-tile:active .room-tile__icon {
    opacity: 1;
    filter: drop-shadow(0 0 8px var(--c-accent-glow));
}

.room-tile__name {
    font-size: 1.0625rem;
    font-weight: 500;
    letter-spacing: var(--tracking-tight);
    line-height: 1.2;
    /* Server-provided names can be anything, including one long word. */
    min-inline-size: 0;
    overflow-wrap: anywhere;
}

/* ---- the filament: the footer's band of light, one tile wide ----------- */

.room-tile::after {
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

.room-tile:hover::after,
.room-tile:focus-visible::after,
.room-tile:active::after {
    transform: scaleX(1);
    opacity: 1;
}

/* ---- no rooms --------------------------------------------------------- */

.home__empty {
    /* `margin: auto` in a flex column, not `place-items: center`: centring
       that never puts content out of reach when the viewport is short. */
    margin: auto;
    display: grid;
    gap: var(--space-2);
    max-inline-size: 22rem;
    text-align: center;
}

.home__empty-title {
    font-size: 1.125rem;
    letter-spacing: var(--tracking-tight);
}

.home__empty-hint {
    font-size: 0.875rem;
    color: var(--c-text-muted);
}

@media (prefers-reduced-motion: reduce) {
    .room-tile,
    .room-tile__icon,
    .room-tile::after {
        transition: none;
    }
}
</style>
