// Climate program model: the wire ranges of each level IO ↔ the slots the
// editor shows. Pure, no Vue (docs/08_http_api.md get_timerange/set_timerange,
// docs/17_device_templates.md "program").
//
// Times are minutes from midnight; 1440 is 24:00. The server has no 24:00
// and its end is inclusive, so 24:00 travels as 23:59:59 and comes back as 1440.

import { isRecord, toWireString } from './guards';

export const MAX_LEVELS = 6;
export const DAY_MINUTES = 1440;
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const WORKDAYS = [1, 2, 3, 4, 5];
export const WEEKEND = [6, 7];

export type Direction = 'heat' | 'cool';

/** One range as it travels: every value a string (start_type 0 = fixed time). */
export interface WireRange {
    day: string;
    start_hour: string;
    start_min: string;
    start_sec: string;
    start_type: string;
    start_offset: string;
    end_hour: string;
    end_min: string;
    end_sec: string;
    end_type: string;
    end_offset: string;
}

/** A slot of one day, never across midnight: 0 ≤ start < end ≤ 1440. */
export interface Slot {
    day: number;
    start: number;
    end: number;
    level: number;
}

export interface Level {
    n: number;
    /** Undefined until the setpoint IO has been read. */
    setpoint: number | undefined;
    /**
     * Sunrise/sunset ranges (start_type ≠ 0) written by the installer: the
     * editor cannot show them but must not erase them on save.
     */
    kept: WireRange[];
}

export interface DirectionProgram {
    direction: Direction;
    levels: Level[];
    slots: Slot[];
}

export type ScheduleError = { kind: 'too_many'; max: number } | { kind: 'invalid_range' } | { kind: 'no_level' };

/** One user action on a direction: the next program, or why it is refused. */
export type ProgramEdit = (program: DirectionProgram) => DirectionProgram | ScheduleError;

// ---------------------------------------------------------------- wire ---

function int(v: unknown): number {
    const text = toWireString(v).trim();
    const n = text === '' ? NaN : Number(text);
    return Number.isInteger(n) ? n : NaN;
}

/** Guard for one range; null when it is not something the server could have sent. */
export function toWireRange(raw: unknown): WireRange | null {
    if (!isRecord(raw)) return null;
    const keys = [
        'day',
        'start_hour',
        'start_min',
        'start_sec',
        'start_type',
        'start_offset',
        'end_hour',
        'end_min',
        'end_sec',
        'end_type',
        'end_offset',
    ] as const;
    const out = {} as WireRange;
    for (const key of keys) out[key] = toWireString(raw[key], key.endsWith('_type') || key.endsWith('_offset') ? '0' : '');
    const day = int(out.day);
    if (!(day >= 1 && day <= 7)) return null;
    for (const key of ['start_hour', 'start_min', 'end_hour', 'end_min'] as const) {
        if (Number.isNaN(int(out[key]))) return null;
    }
    if (out.start_sec === '') out.start_sec = '0';
    if (out.end_sec === '') out.end_sec = '0';
    return out;
}

function isFixed(r: WireRange): boolean {
    return r.start_type === '0' && r.end_type === '0';
}

function wireToMinutes(hour: string, min: string, sec: string): number {
    const m = int(hour) * 60 + int(min);
    // 23:59:59 is how a slot ending at midnight is stored.
    return m === DAY_MINUTES - 1 && int(sec) === 59 ? DAY_MINUTES : m;
}

function nextDay(day: number): number {
    return (day % 7) + 1;
}

/** Wire ranges of one level → its slots (a wrapping range is split at midnight). */
export function rangesToSlots(level: number, ranges: WireRange[]): { slots: Slot[]; kept: WireRange[] } {
    const slots: Slot[] = [];
    const kept: WireRange[] = [];
    for (const r of ranges) {
        if (!isFixed(r)) {
            kept.push(r);
            continue;
        }
        const day = int(r.day);
        const start = wireToMinutes(r.start_hour, r.start_min, '0');
        const end = wireToMinutes(r.end_hour, r.end_min, r.end_sec);
        const startSec = (int(r.start_hour) * 60 + int(r.start_min)) * 60 + int(r.start_sec);
        const endSec = (int(r.end_hour) * 60 + int(r.end_min)) * 60 + int(r.end_sec);
        if (end > start) {
            slots.push({ day, start, end, level });
        } else if (startSec <= endSec) {
            // The server treats start <= end as a plain range inside its day (so start == end is an
            // instant, not 24 h); the minute grid cannot show it, and rewriting it would widen it.
            kept.push(r);
        } else {
            // The server wraps end < start over midnight.
            slots.push({ day, start, end: DAY_MINUTES, level });
            if (end > 0) slots.push({ day: nextDay(day), start: 0, end, level });
        }
    }
    return { slots: sortSlots(slots), kept };
}

function pad(n: number): string {
    return String(n);
}

function slotToWire(s: Slot): WireRange {
    const atMidnight = s.end >= DAY_MINUTES;
    return {
        day: String(s.day),
        start_hour: pad(Math.floor(s.start / 60)),
        start_min: pad(s.start % 60),
        start_sec: '0',
        start_type: '0',
        start_offset: '0',
        end_hour: atMidnight ? '23' : pad(Math.floor(s.end / 60)),
        end_min: atMidnight ? '59' : pad(s.end % 60),
        end_sec: atMidnight ? '59' : '0',
        end_type: '0',
        end_offset: '0',
    };
}

/** The full list of one level, as `set_timerange` must receive it. */
export function levelRanges(program: DirectionProgram, n: number): WireRange[] {
    const kept = program.levels.find((l) => l.n === n)?.kept ?? [];
    return [...program.slots.filter((s) => s.level === n).map(slotToWire), ...kept];
}

export function sortSlots(slots: Slot[]): Slot[] {
    return [...slots].sort((a, b) => a.day - b.day || a.start - b.start || a.level - b.level || a.end - b.end);
}

/** Builds a direction from what was read: level n → its ranges and setpoint. */
export function programFromWire(
    direction: Direction,
    read: { n: number; ranges: WireRange[]; setpoint: number | undefined }[],
): DirectionProgram {
    const levels: Level[] = [];
    let slots: Slot[] = [];
    for (const { n, ranges, setpoint } of [...read].sort((a, b) => a.n - b.n)) {
        const parsed = rangesToSlots(n, ranges);
        levels.push({ n, setpoint, kept: parsed.kept });
        slots = slots.concat(parsed.slots);
    }
    return { direction, levels, slots: sortSlots(slots) };
}

// ------------------------------------------------------------- editing ---

export function slotsOfDay(program: DirectionProgram, day: number): Slot[] {
    return program.slots.filter((s) => s.day === day);
}

export function setpointOf(program: DirectionProgram, n: number): number | undefined {
    return program.levels.find((l) => l.n === n)?.setpoint;
}

/** Levels that hold at least one range: what the tab counts. */
export function usedLevels(program: DirectionProgram): number[] {
    const used = new Set<number>(program.slots.map((s) => s.level));
    for (const l of program.levels) if (l.kept.length > 0) used.add(l.n);
    return [...used].sort((a, b) => a - b);
}

/**
 * The level a setpoint goes to: the first one already at that temperature,
 * else the first one holding no range. `ignore` frees the slots being edited.
 */
export function levelFor(
    program: DirectionProgram,
    setpoint: number,
    ignore: Slot[] = [],
): { n: number; isNew: boolean } | ScheduleError {
    if (program.levels.length === 0) return { kind: 'no_level' };
    const rest = program.slots.filter((s) => !ignore.includes(s));
    const busy = new Set(rest.map((s) => s.level));
    for (const l of program.levels) if (l.kept.length > 0) busy.add(l.n);
    const same = program.levels.find((l) => l.setpoint === setpoint && busy.has(l.n));
    if (same) return { n: same.n, isNew: false };
    const free = program.levels.find((l) => !busy.has(l.n));
    if (free) return { n: free.n, isNew: free.setpoint !== setpoint };
    return { kind: 'too_many', max: program.levels.length };
}

export function isError(v: unknown): v is ScheduleError {
    return isRecord(v) && typeof v.kind === 'string';
}

/**
 * One form entry → day slots. An end at or before the start crosses midnight
 * and is split (J start–24:00, J+1 00:00–end); an end of 00:00 means midnight.
 */
export function splitEntry(days: number[], start: number, end: number, level: number): Slot[] | ScheduleError {
    if (start < 0 || start >= DAY_MINUTES || end < 0 || end > DAY_MINUTES || start === end) {
        return { kind: 'invalid_range' };
    }
    const out: Slot[] = [];
    for (const day of days) {
        if (end > start) out.push({ day, start, end, level });
        else if (end === 0) out.push({ day, start, end: DAY_MINUTES, level });
        else {
            out.push({ day, start, end: DAY_MINUTES, level });
            out.push({ day: nextDay(day), start: 0, end, level });
        }
    }
    return out;
}

/**
 * Adds (or replaces `replacing` with) a slot. The level is found from the
 * setpoint, never chosen: one temperature = one level.
 */
export function upsertSlot(
    program: DirectionProgram,
    entry: { days: number[]; start: number; end: number; setpoint: number },
    replacing: Slot[] = [],
): DirectionProgram | ScheduleError {
    const target = levelFor(program, entry.setpoint, replacing);
    if (isError(target)) return target;
    const added = splitEntry(entry.days, entry.start, entry.end, target.n);
    if (isError(added)) return added;
    const levels = program.levels.map((l) => (l.n === target.n ? { ...l, setpoint: entry.setpoint } : l));
    // A retry replays the edit on a state the first attempt may have partly written: no duplicate.
    const dup = (s: Slot) => added.some((a) => a.day === s.day && a.start === s.start && a.end === s.end && a.level === s.level);
    const slots = sortSlots([...program.slots.filter((s) => !replacing.includes(s) && !dup(s)), ...added]);
    return { ...program, levels, slots };
}

export interface Overlap {
    other: Slot;
    mineLevel: number;
    /** The overlapping part, in minutes of `other.day`. */
    from: number;
    to: number;
}

/**
 * The first slot of another level that the entry would overlap (the lowest
 * level wins there). A slot at the same setpoint shares the level: no overlap.
 */
export function findOverlap(
    program: DirectionProgram,
    entry: { day: number; start: number; end: number; setpoint: number },
    replacing: Slot[] = [],
): Overlap | null {
    const target = levelFor(program, entry.setpoint, replacing);
    if (isError(target)) return null;
    const parts = splitEntry([entry.day], entry.start, entry.end, target.n);
    if (isError(parts)) return null;
    for (const part of parts) {
        for (const s of program.slots) {
            if (s.day !== part.day || s.level === target.n || replacing.includes(s)) continue;
            const from = Math.max(s.start, part.start);
            const to = Math.min(s.end, part.end);
            if (from < to) return { other: s, mineLevel: target.n, from, to };
        }
    }
    return null;
}

export function removeSlots(program: DirectionProgram, gone: Slot[]): DirectionProgram {
    return { ...program, slots: program.slots.filter((s) => !gone.includes(s)) };
}

/**
 * Overwrites every target day with the source day's slots, same levels, so
 * no level is created and the limit cannot be hit.
 */
export function copyDay(program: DirectionProgram, source: number, targets: number[]): DirectionProgram {
    const dst = targets.filter((d) => d !== source);
    const from = slotsOfDay(program, source);
    const keep = program.slots.filter((s) => !dst.includes(s.day));
    const copies = dst.flatMap((day) => from.map((s) => ({ ...s, day })));
    return { ...program, slots: sortSlots([...keep, ...copies]) };
}

/**
 * Swaps the priority of two levels. Ranges and setpoints move together, so
 * what runs when does not change; only who wins an overlap does.
 */
export function swapLevels(program: DirectionProgram, a: number, b: number): DirectionProgram {
    const la = program.levels.find((l) => l.n === a);
    const lb = program.levels.find((l) => l.n === b);
    if (!la || !lb || a === b) return program;
    const swap = (k: number) => (k === a ? b : k === b ? a : k);
    const levels = program.levels.map((l) => (l.n === a ? { ...lb, n: a } : l.n === b ? { ...la, n: b } : l));
    const slots = sortSlots(program.slots.map((s) => ({ ...s, level: swap(s.level) })));
    return { ...program, levels, slots };
}

/** What a save must write: levels whose ranges or setpoint differ. */
export function diffPrograms(
    before: DirectionProgram,
    after: DirectionProgram,
): { ranges: number[]; setpoints: number[] } {
    const ranges: number[] = [];
    const setpoints: number[] = [];
    for (const l of after.levels) {
        if (JSON.stringify(levelRanges(before, l.n)) !== JSON.stringify(levelRanges(after, l.n))) ranges.push(l.n);
        const prev = setpointOf(before, l.n);
        if (l.setpoint !== undefined && l.setpoint !== prev) setpoints.push(l.n);
    }
    return { ranges, setpoints };
}

// ------------------------------------------------------------- display ---

export interface Piece {
    start: number;
    end: number;
    /** null outside every slot: the default setpoint, or off. */
    level: number | null;
}

/**
 * What actually runs over one day: overlaps resolved by priority (level 1
 * wins), gaps filled with `level: null`.
 */
export function effectiveDay(program: DirectionProgram, day: number): Piece[] {
    const slots = slotsOfDay(program, day);
    const cuts = new Set<number>([0, DAY_MINUTES]);
    for (const s of slots) {
        cuts.add(s.start);
        cuts.add(s.end);
    }
    const points = [...cuts].sort((a, b) => a - b);
    const pieces: Piece[] = [];
    for (let i = 0; i + 1 < points.length; i++) {
        const start = points[i];
        const end = points[i + 1];
        const covering = slots.filter((s) => s.start <= start && s.end >= end).map((s) => s.level);
        const level = covering.length > 0 ? Math.min(...covering) : null;
        const last = pieces[pieces.length - 1];
        if (last && last.level === level) last.end = end;
        else pieces.push({ start, end, level });
    }
    return pieces;
}

export function formatMinutes(m: number): string {
    const h = Math.floor(m / 60);
    return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "HH:MM" from an <input type=time> → minutes, or NaN. */
export function parseMinutes(text: string): number {
    const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text);
    if (!match) return NaN;
    const h = Number(match[1]);
    const m = Number(match[2]);
    return h <= 23 && m <= 59 ? h * 60 + m : NaN;
}

/** Program IOs of one direction, read by role from `device.ios` (never rebuilt). */
export function levelIos(ios: Record<string, string>, direction: Direction): { n: number; id: string; setpointId: string }[] {
    const out: { n: number; id: string; setpointId: string }[] = [];
    for (let n = 1; n <= MAX_LEVELS; n++) {
        const id = ios[`${direction}_level${n}`];
        const setpointId = ios[`${direction}_level${n}_setpoint`];
        if (id && setpointId) out.push({ n, id, setpointId });
    }
    return out;
}

/** What the server answers a write from a service-scope session. */
export const SCOPE_DENIED = 'scope denied';

/** Server error strings of set_timerange → an i18n key under `schedule.error`. */
export function errorKey(error: string): string {
    switch (error) {
        case 'invalid ranges':
        case 'invalid range':
            return 'range';
        case 'config_not_written':
            return 'notWritten';
        case SCOPE_DENIED:
            return 'scopeDenied';
        case 'timeout':
            return 'timeout';
        default:
            return 'generic';
    }
}
