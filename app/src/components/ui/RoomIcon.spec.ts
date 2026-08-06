import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
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
import RoomIcon, {
    ROOM_TYPES,
    UNKNOWN_ROOM_TYPE,
    resolveRoomType,
    roomTypeLabelKey,
} from './RoomIcon.vue';
import en from '../../i18n/en.json';
import type { Component } from 'vue';

/**
 * The old map in full (src/scripts/utils.js `getRoomTypeIcon`), alias by
 * alias, so a lost branch fails here rather than showing the wrong glyph on
 * someone's wall panel.
 */
const OLD_MAP: [string, string, Component][] = [
    ['salon', 'lounge', IconSofa],
    ['lounge', 'lounge', IconSofa],
    ['chambre', 'bedroom', IconBed],
    ['bedroom', 'bedroom', IconBed],
    ['cuisine', 'kitchen', IconStove],
    ['kitchen', 'kitchen', IconStove],
    ['bureau', 'office', IconDesk],
    ['office', 'office', IconDesk],
    ['sam', 'diningRoom', IconSilverware],
    ['diningroom', 'diningRoom', IconSilverware],
    ['cave', 'cellar', IconBottleWine],
    ['cellar', 'cellar', IconBottleWine],
    ['divers', 'various', IconShape],
    ['various', 'various', IconShape],
    ['misc', 'various', IconShape],
    ['exterieur', 'outside', IconTree],
    ['outside', 'outside', IconTree],
    ['sdb', 'bathroom', IconShower],
    ['bathroom', 'bathroom', IconShower],
    ['hall', 'corridor', IconDoorOpen],
    ['couloir', 'corridor', IconDoorOpen],
    ['corridor', 'corridor', IconDoorOpen],
    ['garage', 'garage', IconGarage],
    ['Internal', 'internal', IconCog],
];

/** The glyph itself, stripped of the wrapper's class/aria attributes. */
function glyph(type: string): string {
    return mount(RoomIcon, { props: { type } }).get('svg').element.innerHTML;
}

function referenceGlyph(icon: Component): string {
    return mount(icon).get('svg').element.innerHTML;
}

describe('resolveRoomType', () => {
    it.each(OLD_MAP)('maps %s to the %s glyph', (wireType, key, icon) => {
        const definition = resolveRoomType(wireType);

        expect(definition.key).toBe(key);
        expect(definition.icon).toBe(icon);
    });

    it('covers every alias the old map knew, and nothing is unreachable', () => {
        const aliases = ROOM_TYPES.flatMap((definition) => definition.aliases);

        expect(new Set(aliases).size).toBe(aliases.length);
        expect(aliases.sort()).toEqual(OLD_MAP.map(([alias]) => alias.toLowerCase()).sort());
    });

    it.each([[''], ['nope'], ['living room'], ['   ']])(
        'falls back to the default room glyph for %o',
        (type) => {
            // The old function never assigned in its `else` branch (it wrote
            // `rname == "room.png"`, a comparison), so this case was broken
            // by construction.
            expect(resolveRoomType(type)).toBe(UNKNOWN_ROOM_TYPE);
            expect(UNKNOWN_ROOM_TYPE.icon).toBe(IconHomeOutline);
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
    it.each(OLD_MAP)('renders the %s glyph', (wireType, _key, icon) => {
        expect(glyph(wireType)).toBe(referenceGlyph(icon));
    });

    it('renders the default glyph for an unknown type', () => {
        expect(glyph('atelier')).toBe(referenceGlyph(IconHomeOutline));
        // Rendered after a known type, the old global-variable way round.
        expect(glyph('salon')).not.toBe(referenceGlyph(IconHomeOutline));
        expect(glyph('atelier')).toBe(referenceGlyph(IconHomeOutline));
    });

    it('is decorative: the room name and its type label carry the meaning', () => {
        const wrapper = mount(RoomIcon, { props: { type: 'salon' } });

        expect(wrapper.get('svg').attributes('aria-hidden')).toBe('true');
        expect(wrapper.get('svg').classes()).toContain('room-icon');
    });
});
