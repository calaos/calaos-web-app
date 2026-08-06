<script setup lang="ts">
// One room: who it is, then what is in it.
//
// The old screen (src/views/room.html) put the IO list in a 53%-wide column
// on the left and the room's name and picture in a floated column on the
// right, on every screen size — on a phone that is a 53% column of controls
// with a picture wedged beside it. Here the room introduces itself in a
// header and the controls run full width under it, in one column that is
// capped so a wall panel does not stretch a toggle across 1400 px.
//
// The header's rule is the filament again (footer light, login underline):
// static this time, because it is the room's own band of light rather than
// something that follows a finger.
//
// The IO list below is deliberately raw — T10 replaces each row's contents
// with `IoRow.vue`. Only the `visible` gate is real, because it is a store
// truth rather than a rendering one (docs/ARCHITECTURE.md: `visible === false`
// → never rendered, uniformly).

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import RoomIcon, { roomTypeLabelKey } from '../components/ui/RoomIcon.vue';
import { useHomeStore } from '../stores/home';
import type { IoItem } from '../protocol/types';

const { t } = useI18n();
const route = useRoute();
const home = useHomeStore();

// The router guarantees a `\d+` param that is in bounds (bounds check in
// router/index.ts), but the room can still be missing for a frame: signing
// out empties the store before the navigation to /login completes.
const room = computed(() => home.getRoom(Number(route.params.roomId)));

const ios = computed<IoItem[]>(() =>
    (room.value?.ioIds ?? [])
        .map((id) => home.getIo(id))
        .filter((io): io is IoItem => io !== undefined && io.visible),
);
</script>

<template>
    <div v-if="room !== undefined" class="room">
        <header class="room__header fade-in-down">
            <span class="room__plate">
                <RoomIcon :type="room.type" class="room__icon" />
            </span>
            <p class="room__type">{{ t(roomTypeLabelKey(room.type)) }}</p>
            <h1 class="room__name">{{ room.name }}</h1>
        </header>

        <!-- T10: `IoRow` mounts inside these list items. -->
        <ul v-if="ios.length > 0" class="room__ios fade-in">
            <li v-for="io in ios" :key="io.id" class="room__io">
                <span class="room__io-name">{{ io.name }}</span>
                <span class="room__io-state">{{ io.state }}</span>
            </li>
        </ul>

        <p v-else class="room__empty fade-in">{{ t('room.empty') }}</p>
    </div>
</template>

<style scoped>
.room {
    display: flex;
    flex-direction: column;
    min-block-size: 100%;
    /* One column of controls, capped: a switch stretched across a desktop is
       a switch whose label and control are 1200 px apart. */
    inline-size: 100%;
    max-inline-size: 44rem;
    margin-inline: auto;
    padding: var(--space-4);
}

/* ---- header ----------------------------------------------------------- */

.room__header {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    column-gap: var(--space-4);
    padding-block-end: var(--space-4);
    margin-block-end: var(--space-4);
}

.room__plate {
    grid-row: span 2;
    display: grid;
    place-items: center;
    inline-size: 3.25rem;
    block-size: 3.25rem;
    background-color: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
}

.room__icon {
    font-size: 1.75rem;
    color: var(--c-accent);
    filter: drop-shadow(0 0 10px var(--c-accent-glow));
}

.room__type {
    /* The tile's eyebrow, kept: the same label that named the glyph in the
       grid names it here. */
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text-muted);
}

.room__name {
    margin-block-start: var(--space-1);
    font-size: clamp(1.375rem, 5vw, 1.75rem);
    font-weight: 400;
    letter-spacing: var(--tracking-tight);
    line-height: 1.15;
    overflow-wrap: anywhere;
}

/* The room's band of light. */
.room__header::after {
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

/* ---- IO list (T10 fills these rows) ----------------------------------- */

.room__ios {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.room__io {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3);
    background-color: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
}

.room__io-state {
    color: var(--c-text-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.room__empty {
    margin: auto;
    color: var(--c-text-muted);
    text-align: center;
}
</style>
