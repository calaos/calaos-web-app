// Guards the one thing a translator can silently break: the key TREE itself.
// vue-i18n falls back to `en` for a missing key with no error (fallbackLocale
// in ./index.ts), so a typo or an unported key in fr.json would ship a silent
// English string rather than fail anything at runtime. This spec is the only
// thing standing between that and CI.

import { describe, expect, it } from 'vitest';
import en from './en.json';
import fr from './fr.json';

/** JSON leaves are always strings here; anything else is a shape bug. */
type Catalog = { [key: string]: Catalog | string };

/** Every leaf's dotted path, in a catalogue of arbitrary nesting depth. */
function keyPaths(catalog: Catalog, prefix = ''): string[] {
    return Object.entries(catalog).flatMap(([key, value]) => {
        const path = prefix === '' ? key : `${prefix}.${key}`;
        if (typeof value === 'string') return [path];
        return keyPaths(value, path);
    });
}

describe('i18n catalogues (en, fr)', () => {
    it('have identical key trees', () => {
        const enPaths = new Set(keyPaths(en));
        const frPaths = new Set(keyPaths(fr));

        const missingInFr = [...enPaths].filter((path) => !frPaths.has(path)).sort();
        const extraInFr = [...frPaths].filter((path) => !enPaths.has(path)).sort();

        expect({ missingInFr, extraInFr }).toEqual({ missingInFr: [], extraInFr: [] });
    });

    it('carries the same {interpolation} placeholders on every shared key', () => {
        // A key can be translated freely, but if en uses {name} and fr drops
        // it (or renames it), the string silently loses the substitution at
        // render time — vue-i18n leaves the literal `{name}` in the output.
        const placeholders = (value: string): string[] =>
            [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

        const enPaths = keyPaths(en);
        const mismatches: { path: string; en: string[]; fr: string[] }[] = [];

        for (const path of enPaths) {
            const enValue = path.split('.').reduce<Catalog | string>((node, segment) => {
                return (node as Catalog)[segment];
            }, en as Catalog) as string;
            const frValue = path.split('.').reduce<Catalog | string | undefined>(
                (node, segment) => (node as Catalog | undefined)?.[segment],
                fr as Catalog,
            ) as string | undefined;
            if (frValue === undefined) continue; // reported by the key-tree test above

            const enPlaceholders = placeholders(enValue);
            const frPlaceholders = placeholders(frValue);
            if (JSON.stringify(enPlaceholders) !== JSON.stringify(frPlaceholders)) {
                mismatches.push({ path, en: enPlaceholders, fr: frPlaceholders });
            }
        }

        expect(mismatches).toEqual([]);
    });

    it('roomType covers every room type, matching the seed from the old app', () => {
        // src/scripts/utils.js getRoomTypeString, with accents fixed (see
        // docs/tasks/T19-i18n.md): Salle à manger and Extérieur lacked theirs.
        const expectedKeys = [
            'lounge',
            'bedroom',
            'kitchen',
            'office',
            'diningRoom',
            'cellar',
            'various',
            'outside',
            'bathroom',
            'corridor',
            'garage',
            'internal',
            'unknown',
        ].sort();

        expect(Object.keys(en.roomType).sort()).toEqual(expectedKeys);
        expect(Object.keys(fr.roomType).sort()).toEqual(expectedKeys);
    });
});
