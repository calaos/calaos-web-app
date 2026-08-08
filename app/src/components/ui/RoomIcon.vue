<script lang="ts">
// The room-type picture — the port of the old `getRoomTypeIcon()`
// (src/scripts/utils.js), keeping the ORIGINAL artwork.
//
// The first rewrite replaced these 220×120 isometric renders with MDI line
// glyphs. That was a downgrade nobody asked for: the pictures are the app's
// face, they say "kitchen" faster than a stove outline does, and at tile size
// a 24px monochrome glyph next to a name is indistinguishable from every other
// row of chrome in the app. The bitmaps are back, and they are shown big.
//
// Three real bugs in the old function are still fixed on the way over:
//
//  1. THE FALLBACK. The old function assigned to `rname` without declaring it,
//     so the variable was an implicit GLOBAL that survived between calls, and
//     its `else rname == "room.png"` line was a comparison, not an assignment.
//     An unrecognized room type therefore rendered whatever icon the PREVIOUS
//     room had resolved to — and the very first one rendered `undefined`.
//     Here an unrecognized type resolves to the default room picture, always.
//  2. CASE. The old comparisons were exact, so a server sending `Salon`
//     (capitalised, as it does for `Internal`) fell through to the fallback.
//     Types are matched case-insensitively and trimmed.
//  3. The type STRING and the type ICON came from two separate 24-branch
//     functions that could (and did) drift apart. One table now carries both:
//     the picture and the i18n key of its label.
//
// The old `room_hall.png` and `room_misc.png` are not restored: they were
// byte-identical duplicates of `room_corridor.png` and `room.png`, and the old
// map never referenced them.
//
// The image fills its box and keeps the artwork's 11:6 aspect — callers size
// it, exactly as they sized the glyph it replaces.

import { computed } from 'vue';
import roomDefault from '../../assets/rooms/room.png';
import roomBureau from '../../assets/rooms/room_bureau.png';
import roomCave from '../../assets/rooms/room_cave.png';
import roomChambre from '../../assets/rooms/room_chambre.png';
import roomCorridor from '../../assets/rooms/room_corridor.png';
import roomCuisine from '../../assets/rooms/room_cuisine.png';
import roomExterieur from '../../assets/rooms/room_exterieur.png';
import roomGarage from '../../assets/rooms/room_garage.png';
import roomSalon from '../../assets/rooms/room_salon.png';
import roomSam from '../../assets/rooms/room_sam.png';
import roomSdb from '../../assets/rooms/room_sdb.png';

export interface RoomTypeDefinition {
    /** i18n key suffix: `roomType.<key>` (app/src/i18n/en.json). */
    key: string;
    /** Resolved URL of the room's picture (Vite-hashed at build time). */
    image: string;
    /** Every wire value that resolves here, lowercased (old `utils.js`). */
    aliases: string[];
}

/**
 * The complete map, in the old function's order, with the old function's
 * artwork. `Internal` is calaos_server's own room (system IOs); the old app
 * gave it the generic room picture and so does this.
 */
export const ROOM_TYPES: RoomTypeDefinition[] = [
    { key: 'lounge', image: roomSalon, aliases: ['salon', 'lounge'] },
    { key: 'bedroom', image: roomChambre, aliases: ['chambre', 'bedroom'] },
    { key: 'kitchen', image: roomCuisine, aliases: ['cuisine', 'kitchen'] },
    { key: 'office', image: roomBureau, aliases: ['bureau', 'office'] },
    { key: 'diningRoom', image: roomSam, aliases: ['sam', 'diningroom'] },
    { key: 'cellar', image: roomCave, aliases: ['cave', 'cellar'] },
    { key: 'various', image: roomDefault, aliases: ['divers', 'various', 'misc'] },
    { key: 'outside', image: roomExterieur, aliases: ['exterieur', 'outside'] },
    { key: 'bathroom', image: roomSdb, aliases: ['sdb', 'bathroom'] },
    { key: 'corridor', image: roomCorridor, aliases: ['hall', 'couloir', 'corridor'] },
    { key: 'garage', image: roomGarage, aliases: ['garage'] },
    { key: 'internal', image: roomDefault, aliases: ['internal'] },
];

/** Where an unknown, empty or misspelled type lands. Never `undefined`. */
export const UNKNOWN_ROOM_TYPE: RoomTypeDefinition = {
    key: 'unknown',
    image: roomDefault,
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
    <!-- Decorative: every room picture in the app sits next to the room's name
         and its translated type, so announcing it again is noise. `alt=""`
         (not just aria-hidden) so a broken image shows nothing rather than a
         filename. -->
    <img class="room-icon" :src="definition.image" alt="" aria-hidden="true" decoding="async" />
</template>

<style scoped>
.room-icon {
    display: block;
    inline-size: 100%;
    block-size: 100%;
    /* The artwork is 220×120 with transparent margins around the render.
       `contain` keeps the room square-on and never crops a wall off, whatever
       box the caller gives it. */
    object-fit: contain;
}
</style>
