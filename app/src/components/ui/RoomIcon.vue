<script lang="ts">
// The room-type glyph — the port of the old `getRoomTypeIcon()`
// (src/scripts/utils.js) from 24 PNG files to compile-time MDI SVGs.
//
// Three things are fixed on the way over:
//
//  1. THE FALLBACK. The old function assigned to `rname` without declaring it,
//     so the variable was an implicit GLOBAL that survived between calls, and
//     its `else rname == "room.png"` line was a comparison, not an assignment.
//     An unrecognized room type therefore rendered whatever icon the PREVIOUS
//     room had resolved to — and the very first one rendered `undefined`.
//     Here an unrecognized type resolves to the default room glyph, always.
//  2. CASE. The old comparisons were exact, so a server sending `Salon`
//     (capitalised, as it does for `Internal`) fell through to the fallback.
//     Types are matched case-insensitively and trimmed.
//  3. The type STRING and the type ICON came from two separate 24-branch
//     functions that could (and did) drift apart. One table now carries both:
//     the icon and the i18n key of its label.
//
// The glyph inherits `font-size` and `color` from its parent — it carries no
// size or colour of its own, exactly like the footer's tab icons.

import type { Component } from 'vue';
import { computed } from 'vue';
import IconBed from '~icons/mdi/bed';
import IconBottleWine from '~icons/mdi/bottle-wine';
import IconCog from '~icons/mdi/cog';
import IconDesk from '~icons/mdi/desk';
import IconDoorOpen from '~icons/mdi/door-open';
import IconGarage from '~icons/mdi/garage';
import IconHomeOutline from '~icons/mdi/home-outline';
import IconShape from '~icons/mdi/shape';
import IconShower from '~icons/mdi/shower';
import IconSilverware from '~icons/mdi/silverware-fork-knife';
import IconSofa from '~icons/mdi/sofa';
import IconStove from '~icons/mdi/stove';
import IconTree from '~icons/mdi/tree';

export interface RoomTypeDefinition {
    /** i18n key suffix: `roomType.<key>` (app/src/i18n/en.json). */
    key: string;
    icon: Component;
    /** Every wire value that resolves here, lowercased (old `utils.js`). */
    aliases: string[];
}

/**
 * The complete map, in the old function's order. `Internal` is calaos_server's
 * own room (system IOs); the old app gave it the generic room picture, this
 * gives it a cog — it is machinery, not a place.
 */
export const ROOM_TYPES: RoomTypeDefinition[] = [
    { key: 'lounge', icon: IconSofa, aliases: ['salon', 'lounge'] },
    { key: 'bedroom', icon: IconBed, aliases: ['chambre', 'bedroom'] },
    { key: 'kitchen', icon: IconStove, aliases: ['cuisine', 'kitchen'] },
    { key: 'office', icon: IconDesk, aliases: ['bureau', 'office'] },
    { key: 'diningRoom', icon: IconSilverware, aliases: ['sam', 'diningroom'] },
    { key: 'cellar', icon: IconBottleWine, aliases: ['cave', 'cellar'] },
    { key: 'various', icon: IconShape, aliases: ['divers', 'various', 'misc'] },
    { key: 'outside', icon: IconTree, aliases: ['exterieur', 'outside'] },
    { key: 'bathroom', icon: IconShower, aliases: ['sdb', 'bathroom'] },
    { key: 'corridor', icon: IconDoorOpen, aliases: ['hall', 'couloir', 'corridor'] },
    { key: 'garage', icon: IconGarage, aliases: ['garage'] },
    { key: 'internal', icon: IconCog, aliases: ['internal'] },
];

/** Where an unknown, empty or misspelled type lands. Never `undefined`. */
export const UNKNOWN_ROOM_TYPE: RoomTypeDefinition = {
    key: 'unknown',
    icon: IconHomeOutline,
    aliases: [],
};

const BY_ALIAS = new Map<string, RoomTypeDefinition>(
    ROOM_TYPES.flatMap((definition) =>
        definition.aliases.map((alias) => [alias, definition] as const),
    ),
);

/** Wire room type → its definition. Total: every input has an answer. */
export function resolveRoomType(type: string): RoomTypeDefinition {
    return BY_ALIAS.get(type.trim().toLowerCase()) ?? UNKNOWN_ROOM_TYPE;
}

/** The i18n key naming a room type: `roomType.kitchen`, `roomType.unknown`… */
export function roomTypeLabelKey(type: string): string {
    return `roomType.${resolveRoomType(type).key}`;
}
</script>

<script setup lang="ts">
const props = defineProps<{
    /** The room's wire `type` — anything at all, including ''. */
    type: string;
}>();

const definition = computed(() => resolveRoomType(props.type));
</script>

<template>
    <!-- Decorative: every room icon in the app sits next to the room's name
         and its translated type, so announcing it again is noise. -->
    <component :is="definition.icon" class="room-icon" aria-hidden="true" />
</template>
