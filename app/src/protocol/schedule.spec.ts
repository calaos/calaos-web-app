import { describe, expect, it } from 'vitest';
import {
    copyDay,
    diffPrograms,
    effectiveDay,
    isError,
    levelFor,
    levelIos,
    levelRanges,
    moveLevel,
    parseMinutes,
    programFromWire,
    rangesToSlots,
    toWireRange,
    upsertSlot,
} from './schedule';
import type { DirectionProgram, WireRange } from './schedule';

function wire(day: number, sh: number, sm: number, eh: number, em: number, es = 0): WireRange {
    return {
        day: String(day),
        start_hour: String(sh),
        start_min: String(sm),
        start_sec: '0',
        start_type: '0',
        start_offset: '0',
        end_hour: String(eh),
        end_min: String(em),
        end_sec: String(es),
        end_type: '0',
        end_offset: '0',
    };
}

function empty(levels = 6, setpoints: (number | undefined)[] = []): DirectionProgram {
    return programFromWire(
        'heat',
        Array.from({ length: levels }, (_, i) => ({ n: i + 1, ranges: [], setpoint: setpoints[i] })),
    );
}

/** Slots → wire → slots, the read a save is followed by. */
function reread(p: DirectionProgram): DirectionProgram {
    return programFromWire(
        p.direction,
        p.levels.map((l) => ({ n: l.n, ranges: levelRanges(p, l.n), setpoint: l.setpoint })),
    );
}

function must(p: DirectionProgram | ReturnType<typeof upsertSlot>): DirectionProgram {
    if (isError(p)) throw new Error(`unexpected ${p.kind}`);
    return p;
}

describe('wire ranges → slots', () => {
    it.each([
        ['plain range', wire(1, 6, 30, 8, 0), [{ day: 1, start: 390, end: 480, level: 1 }]],
        ['23:59:59 is midnight', wire(3, 22, 30, 23, 59, 59), [{ day: 3, start: 1350, end: 1440, level: 1 }]],
        ['23:59:00 stays 23:59', wire(3, 22, 0, 23, 59, 0), [{ day: 3, start: 1320, end: 1439, level: 1 }]],
        [
            'a wrapping range is split over two days',
            wire(5, 22, 30, 6, 0),
            [
                { day: 5, start: 1350, end: 1440, level: 1 },
                { day: 6, start: 0, end: 360, level: 1 },
            ],
        ],
        [
            'sunday wraps to monday',
            wire(7, 23, 0, 1, 0),
            [
                { day: 1, start: 0, end: 60, level: 1 },
                { day: 7, start: 1380, end: 1440, level: 1 },
            ],
        ],
    ])('%s', (_label, range, slots) => {
        expect(rangesToSlots(1, [range]).slots).toEqual(slots);
    });

    it('keeps sunrise/sunset ranges untouched and writes them back', () => {
        const solar = { ...wire(2, 0, 0, 0, 30), start_type: '1', start_offset: '-1' };
        const p = programFromWire('heat', [{ n: 1, ranges: [wire(1, 6, 0, 8, 0), solar], setpoint: 20 }]);
        expect(p.slots).toHaveLength(1);
        expect(levelRanges(p, 1)).toEqual([wire(1, 6, 0, 8, 0), solar]);
    });

    it.each([
        ['not an object', 'x'],
        ['day out of range', { ...wire(1, 1, 0, 2, 0), day: '8' }],
        ['hour missing', { ...wire(1, 1, 0, 2, 0), start_hour: undefined }],
    ])('guard refuses %s', (_label, raw) => {
        expect(toWireRange(raw)).toBeNull();
    });
});

describe('round trip timeline → ranges → timeline', () => {
    it('several slots, a midnight crossing and six levels survive a save and a re-read', () => {
        let p = empty(6);
        const entries = [
            { days: [1, 2, 3, 4, 5], start: 390, end: 480, setpoint: 20.5 },
            { days: [1, 2, 3, 4, 5], start: 1050, end: 1350, setpoint: 21 },
            { days: [5], start: 1350, end: 360, setpoint: 18 },
            { days: [6, 7], start: 480, end: 720, setpoint: 22 },
            { days: [6], start: 720, end: 0, setpoint: 19.5 },
            { days: [3], start: 720, end: 840, setpoint: 23 },
        ];
        for (const e of entries) p = must(upsertSlot(p, e));

        expect(p.levels.map((l) => l.setpoint)).toEqual([20.5, 21, 18, 22, 19.5, 23]);
        expect(p.slots.filter((s) => s.day === 6 && s.level === 3)).toEqual([{ day: 6, start: 0, end: 360, level: 3 }]);
        expect(levelRanges(p, 3)).toEqual([wire(5, 22, 30, 23, 59, 59), wire(6, 0, 0, 6, 0)]);

        const back = reread(p);
        expect(back).toEqual(p);
        for (const day of [1, 2, 3, 4, 5, 6, 7]) expect(effectiveDay(back, day)).toEqual(effectiveDay(p, day));
    });

    it('a seventh temperature is refused before anything is written', () => {
        let p = empty(6);
        for (const [i, sp] of [17, 18, 19, 20, 21, 22].entries()) {
            p = must(upsertSlot(p, { days: [1], start: i * 60, end: i * 60 + 30, setpoint: sp }));
        }
        expect(upsertSlot(p, { days: [2], start: 600, end: 660, setpoint: 23 })).toEqual({ kind: 'too_many', max: 6 });
        // An existing temperature still fits.
        expect(isError(upsertSlot(p, { days: [2], start: 600, end: 660, setpoint: 20 }))).toBe(false);
    });

    it('the limit is the number of level IOs the device has', () => {
        let p = empty(2);
        p = must(upsertSlot(p, { days: [1], start: 0, end: 60, setpoint: 19 }));
        p = must(upsertSlot(p, { days: [1], start: 60, end: 120, setpoint: 20 }));
        expect(upsertSlot(p, { days: [1], start: 120, end: 180, setpoint: 21 })).toEqual({ kind: 'too_many', max: 2 });
    });

    it('an empty day reads as "off" or the default, never as a level', () => {
        const p = must(upsertSlot(empty(2), { days: [1], start: 600, end: 720, setpoint: 26 }));
        expect(effectiveDay(p, 1)).toEqual([
            { start: 0, end: 600, level: null },
            { start: 600, end: 720, level: 1 },
            { start: 720, end: 1440, level: null },
        ]);
        expect(effectiveDay(p, 2)).toEqual([{ start: 0, end: 1440, level: null }]);
        expect(effectiveDay(reread(p), 1)).toEqual(effectiveDay(p, 1));
    });
});

describe('grouping by temperature', () => {
    it('reuses the level at the same setpoint, else the first free one', () => {
        let p = empty(3);
        p = must(upsertSlot(p, { days: [1], start: 0, end: 60, setpoint: 19 }));
        p = must(upsertSlot(p, { days: [2], start: 0, end: 60, setpoint: 19 }));
        expect(new Set(p.slots.map((s) => s.level))).toEqual(new Set([1]));
        expect(levelFor(p, 21)).toEqual({ n: 2, isNew: true });
    });

    it('editing the only slot of a level to a new temperature keeps the level', () => {
        let p = empty(1);
        p = must(upsertSlot(p, { days: [1], start: 0, end: 60, setpoint: 19 }));
        p = must(upsertSlot(p, { days: [1], start: 0, end: 60, setpoint: 22 }, [p.slots[0]]));
        expect(p.levels[0].setpoint).toBe(22);
        expect(p.slots).toEqual([{ day: 1, start: 0, end: 60, level: 1 }]);
    });

    it.each([
        ['end equal to start', 600, 600],
        ['start at 24:00', 1440, 60],
    ])('refuses %s', (_label, start, end) => {
        expect(upsertSlot(empty(1), { days: [1], start, end, setpoint: 20 })).toEqual({ kind: 'invalid_range' });
    });

    it('priority: level 1 wins where slots overlap', () => {
        let p = empty(2);
        p = must(upsertSlot(p, { days: [1], start: 0, end: 600, setpoint: 19 }));
        p = must(upsertSlot(p, { days: [1], start: 300, end: 900, setpoint: 21 }));
        expect(effectiveDay(p, 1).map((x) => x.level)).toEqual([1, 2, null]);
        const swapped = moveLevel(p, 2, -1);
        expect(swapped.levels.map((l) => l.setpoint)).toEqual([21, 19]);
        expect(effectiveDay(swapped, 1)).toEqual([
            { start: 0, end: 300, level: 2 },
            { start: 300, end: 900, level: 1 },
            { start: 900, end: 1440, level: null },
        ]);
        expect(diffPrograms(p, swapped)).toEqual({ ranges: [1, 2], setpoints: [1, 2] });
    });
});

describe('copy a day', () => {
    it('overwrites the targets with the source slots, at the same levels', () => {
        let p = empty(2);
        p = must(upsertSlot(p, { days: [3], start: 390, end: 480, setpoint: 20 }));
        p = must(upsertSlot(p, { days: [3], start: 1350, end: 360, setpoint: 18 }));
        p = must(upsertSlot(p, { days: [5], start: 0, end: 1440, setpoint: 20 }));
        const c = copyDay(p, 3, [3, 5, 6]);
        expect(c.slots.filter((s) => s.day === 5)).toEqual(p.slots.filter((s) => s.day === 3).map((s) => ({ ...s, day: 5 })));
        // The 00:00–06:00 half stored on thursday is not part of wednesday.
        expect(c.slots.filter((s) => s.day === 4)).toEqual(p.slots.filter((s) => s.day === 4));
        expect(c.slots.filter((s) => s.day === 6)).toEqual(p.slots.filter((s) => s.day === 3).map((s) => ({ ...s, day: 6 })));
        expect(diffPrograms(p, c).ranges).toEqual([1, 2]);
    });
});

describe('cool "off" default', () => {
    // "Off" is not a level: it is what a gap means when cool_default_off is true,
    // so the protocol must never write or read anything for it.
    const coolIos = {
        cool_level1: 'C1',
        cool_level1_setpoint: 'C1S',
        cool_level2: 'C2',
        cool_level2_setpoint: 'C2S',
        cool_default: 'CD',
        cool_default_off: 'COFF',
    };

    it('levelIos never takes the default or the off switch for a level', () => {
        expect(levelIos(coolIos, 'cool')).toEqual([
            { n: 1, id: 'C1', setpointId: 'C1S' },
            { n: 2, id: 'C2', setpointId: 'C2S' },
        ]);
        expect(levelIos({ cool_default_off: 'COFF', cool_default: 'CD' }, 'cool')).toEqual([]);
    });

    it('a cool program with no slot has gaps only, and writes no range at all', () => {
        const p = programFromWire('cool', [
            { n: 1, ranges: [], setpoint: 26 },
            { n: 2, ranges: [], setpoint: 24 },
        ]);
        for (let day = 1; day <= 7; day++) expect(effectiveDay(p, day)).toEqual([{ start: 0, end: 1440, level: null }]);
        expect(levelRanges(p, 1)).toEqual([]);
        expect(levelRanges(p, 2)).toEqual([]);
        expect(diffPrograms(p, p)).toEqual({ ranges: [], setpoints: [] });
    });

    it('slots stay levels and the surrounding gaps stay null, so "off" only ever shows in the gaps', () => {
        const p = programFromWire('cool', [{ n: 1, ranges: [wire(2, 12, 0, 18, 0)], setpoint: 26 }]);
        expect(effectiveDay(p, 2)).toEqual([
            { start: 0, end: 720, level: null },
            { start: 720, end: 1080, level: 1 },
            { start: 1080, end: 1440, level: null },
        ]);
        expect(effectiveDay(p, 3)).toEqual([{ start: 0, end: 1440, level: null }]);
    });
});

describe('helpers', () => {
    it('reads level IOs by role, never rebuilding ids', () => {
        expect(
            levelIos(
                { heat_level1: 'a_heat_level1_2', heat_level1_setpoint: 'sp', heat_level2: 'x', cool_level1: 'c' },
                'heat',
            ),
        ).toEqual([{ n: 1, id: 'a_heat_level1_2', setpointId: 'sp' }]);
    });

    it.each([
        ['06:30', 390],
        ['6:05', 365],
        ['23:59:00', 1439],
        ['24:00', NaN],
        ['', NaN],
    ])('parseMinutes(%s)', (text, minutes) => {
        expect(parseMinutes(text)).toBe(minutes);
    });
});
