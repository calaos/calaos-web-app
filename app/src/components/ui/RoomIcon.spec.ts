import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import RoomIcon, {
    ROOM_TYPES,
    UNKNOWN_ROOM_TYPE,
    resolveRoomType,
    roomTypeLabelKey,
} from './RoomIcon.vue';
import en from '../../i18n/en.json';

/**
 * The old map in full (src/scripts/utils.js `getRoomTypeIcon`), alias by
 * alias, so a lost branch fails here rather than showing the wrong room on
 * someone's wall panel.
 *
 * The third column is the old PNG's basename. Asserting on the FILENAME rather
 * than on a resolved URL is the point: these are the original bitmaps, and the
 * test's job is to prove each alias still lands on the same artwork the old
 * app shipped. Vite hashes the URL at build time; the basename survives.
 */
const OLD_MAP: [string, string, string][] = [
    ['salon', 'lounge', 'room_salon'],
    ['lounge', 'lounge', 'room_salon'],
    ['chambre', 'bedroom', 'room_chambre'],
    ['bedroom', 'bedroom', 'room_chambre'],
    ['cuisine', 'kitchen', 'room_cuisine'],
    ['kitchen', 'kitchen', 'room_cuisine'],
    ['bureau', 'office', 'room_bureau'],
    ['office', 'office', 'room_bureau'],
    ['sam', 'diningRoom', 'room_sam'],
    ['diningroom', 'diningRoom', 'room_sam'],
    ['cave', 'cellar', 'room_cave'],
    ['cellar', 'cellar', 'room_cave'],
    // The old map sent all three of these to the generic `room.png`, not to
    // the `room_misc.png` sitting next to it in the images folder.
    ['divers', 'various', 'room'],
    ['various', 'various', 'room'],
    ['misc', 'various', 'room'],
    ['exterieur', 'outside', 'room_exterieur'],
    ['outside', 'outside', 'room_exterieur'],
    ['sdb', 'bathroom', 'room_sdb'],
    ['bathroom', 'bathroom', 'room_sdb'],
    // Likewise `hall` → `room_corridor.png`; `room_hall.png` was never used.
    ['hall', 'corridor', 'room_corridor'],
    ['couloir', 'corridor', 'room_corridor'],
    ['corridor', 'corridor', 'room_corridor'],
    ['garage', 'garage', 'room_garage'],
    ['Internal', 'internal', 'room'],
];

/** The PNG basename behind a resolved (possibly hashed) asset URL. */
function basename(url: string): string {
    const file = url.split('/').pop() ?? '';
    // `room_salon.png` in dev, `room_salon-a1b2c3d4.png` once Vite has hashed
    // it: strip the extension and any build hash suffix.
    return file.replace(/\.png$/, '').replace(/-[A-Za-z0-9_-]{8,}$/, '');
}

/** The `src` the component actually rendered, as a PNG basename. */
function rendered(type: string): string {
    const src = mount(RoomIcon, { props: { type } }).get('img').attributes('src');
    return basename(src ?? '');
}

describe('resolveRoomType', () => {
    it.each(OLD_MAP)('maps %s to the %s picture', (wireType, key, image) => {
        const definition = resolveRoomType(wireType);

        expect(definition.key).toBe(key);
        expect(basename(definition.image)).toBe(image);
    });

    it('covers every alias the old map knew, and nothing is unreachable', () => {
        const aliases = ROOM_TYPES.flatMap((definition) => definition.aliases);

        expect(new Set(aliases).size).toBe(aliases.length);
        expect(aliases.sort()).toEqual(OLD_MAP.map(([alias]) => alias.toLowerCase()).sort());
    });

    it.each([[''], ['nope'], ['living room'], ['   ']])(
        'falls back to the default room picture for %o',
        (type) => {
            // The old function never assigned in its `else` branch (it wrote
            // `rname == "room.png"`, a comparison), so this case was broken
            // by construction.
            expect(resolveRoomType(type)).toBe(UNKNOWN_ROOM_TYPE);
            expect(basename(UNKNOWN_ROOM_TYPE.image)).toBe('room');
        },
    );

    it('ignores case and surrounding space', () => {
        // The server capitalises at least one type ('Internal'), and the old
        // exact `==` comparisons meant any other capitalisation fell through.
        expect(resolveRoomType('SALON').key).toBe('lounge');
        expect(resolveRoomType('Kitchen').key).toBe('kitchen');
        expect(resolveRoomType(' internal ').key).toBe('internal');
    });

    it('never leaks the previous lookup into the next one', () => {
        // THE bug being fixed: `rname` was an undeclared (global) variable, so
        // an unknown type returned whatever the last known room resolved to.
        expect(resolveRoomType('salon').key).toBe('lounge');
        expect(resolveRoomType('atelier')).toBe(UNKNOWN_ROOM_TYPE);
        expect(resolveRoomType('atelier')).toBe(UNKNOWN_ROOM_TYPE);
    });

    it('gives every type a real picture', () => {
        for (const definition of [...ROOM_TYPES, UNKNOWN_ROOM_TYPE]) {
            expect(definition.image, `missing image for ${definition.key}`).toBeTruthy();
            expect(definition.image).toMatch(/\.png/);
        }
    });
});

describe('roomTypeLabelKey', () => {
    it('names the translation of a type', () => {
        expect(roomTypeLabelKey('cuisine')).toBe('roomType.kitchen');
        expect(roomTypeLabelKey('atelier')).toBe('roomType.unknown');
    });

    it('has a translation for every type, fallback included', () => {
        const catalogue = en.roomType as Record<string, string | undefined>;

        for (const definition of [...ROOM_TYPES, UNKNOWN_ROOM_TYPE]) {
            expect(catalogue[definition.key], `missing roomType.${definition.key}`).toBeTruthy();
        }
    });
});

describe('RoomIcon', () => {
    it.each(OLD_MAP)('renders the %s picture', (wireType, _key, image) => {
        expect(rendered(wireType)).toBe(image);
    });

    it('renders the original artwork, not a glyph', () => {
        // The rewrite replaced these 220x120 renders with MDI line icons; this
        // is the assertion that stops that happening again by accident.
        const wrapper = mount(RoomIcon, { props: { type: 'salon' } });

        expect(wrapper.find('img').exists()).toBe(true);
        expect(wrapper.find('svg').exists()).toBe(false);
    });

    it('renders the default picture for an unknown type', () => {
        expect(rendered('atelier')).toBe('room');
        // Rendered after a known type, the old global-variable way round.
        expect(rendered('salon')).not.toBe('room');
        expect(rendered('atelier')).toBe('room');
    });

    it('is decorative: the room name and its type label carry the meaning', () => {
        const img = mount(RoomIcon, { props: { type: 'salon' } }).get('img');

        expect(img.attributes('aria-hidden')).toBe('true');
        // Empty alt, not a filename: a broken image must say nothing rather
        // than announce `room_salon.png`.
        expect(img.attributes('alt')).toBe('');
        expect(img.classes()).toContain('room-icon');
    });
});
