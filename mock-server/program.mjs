// Climate time programs: the hidden IOs a climate owns (level time ranges,
// level setpoints, defaults) and get_timerange / set_timerange on them, with
// the validation and error strings of calaos_base docs/08_http_api.md.
// The IOs are in no room, like on the real server: only get_state, set_state
// and the timerange messages reach them.

import { readFileSync } from 'node:fs';

const FIXTURE_URL = new URL('./fixtures/program.json', import.meta.url);

const RANGE_FIELDS = {
    start_hour: [0, 23],
    start_min: [0, 59],
    start_sec: [0, 59],
    start_type: [0, 3],
    start_offset: [-Infinity, Infinity],
    end_hour: [0, 23],
    end_min: [0, 59],
    end_sec: [0, 59],
    end_type: [0, 3],
    end_offset: [-Infinity, Infinity],
};

function loadFixture() {
    return JSON.parse(readFileSync(FIXTURE_URL, 'utf8'));
}

/** Strings or JSON integers, as the server accepts both. */
function integer(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? v : NaN;
    if (typeof v !== 'string' || !/^-?\d+$/.test(v.trim())) return NaN;
    return Number(v);
}

/** @returns {{ ranges?: object[], error?: string }} */
export function validateRanges(ranges) {
    if (!Array.isArray(ranges) || ranges.some((r) => typeof r !== 'object' || r === null || Array.isArray(r))) {
        return { error: 'invalid ranges' };
    }
    const out = [];
    for (const r of ranges) {
        const day = integer(r.day);
        if (!(day >= 1 && day <= 7)) return { error: 'invalid day' };
        const range = { day: String(day) };
        for (const [field, [min, max]] of Object.entries(RANGE_FIELDS)) {
            const n = integer(r[field]);
            if (Number.isNaN(n) || n < min || n > max) return { error: 'invalid range' };
            range[field] = String(n);
        }
        out.push(range);
    }
    return { ranges: out };
}

const LOOKAHEAD_DAYS = 7;

function pad(n) {
    return String(n).padStart(2, '0');
}

/** `2026-11-18T17:30:00+01:00`: the wire form of `next_change.at`. */
export function isoWithOffset(date) {
    const off = -date.getTimezoneOffset();
    const sign = off < 0 ? '-' : '+';
    const abs = Math.abs(off);
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
        `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
        `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
    );
}

const isoDay = (date) => date.getDay() || 7;
const secondsOfDay = (date) => date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();

/** Seconds since midnight of a fixed-time range end; the server's 23:59:59 end covers the whole day. */
function bounds(r) {
    return [
        Number(r.start_hour) * 3600 + Number(r.start_min) * 60 + Number(r.start_sec),
        Number(r.end_hour) * 3600 + Number(r.end_min) * 60 + Number(r.end_sec),
    ];
}

/**
 * @param {{ broadcast?: (frame: object) => void, onChange?: () => void }} [options]
 *   `onChange` runs after a program IO or a level's ranges changed.
 */
export function createProgram({ broadcast = () => {}, onChange = () => {} } = {}) {
    /** Fixed `now` for the program state, so a test can name the hour. */
    let clock = null;
    /** Withheld `state.program`, for the loading view. */
    let hidden = false;
    /** @type {Map<string, {gui_type: string, state: string}>} */
    let values;
    /** @type {Map<string, {months: string, ranges: object[]}>} */
    let timeranges;
    /** set_timerange calls still to answer normally before the armed failure. */
    let failAfter = -1;

    function reset() {
        const fixture = loadFixture();
        values = new Map(Object.entries(fixture.values).map(([id, v]) => [id, { ...v }]));
        timeranges = new Map(
            Object.entries(fixture.timeranges).map(([id, ranges]) => [id, { months: '111111111111', ranges }]),
        );
        failAfter = -1;
        clock = null;
        hidden = false;
    }
    reset();

    const number = (id) => {
        const v = Number(values.get(id)?.state);
        return Number.isFinite(v) ? v : null;
    };

    /** The level in force for one set at `at`: the lowest-numbered one whose range holds it. */
    function levelAt(ios, set, at) {
        const day = String(isoDay(at));
        const sec = secondsOfDay(at);
        for (let n = 1; n <= 6; n++) {
            const id = ios[`${set}_level${n}`];
            for (const r of timeranges.get(id)?.ranges ?? []) {
                if (r.day !== day || r.start_type !== '0' || r.end_type !== '0') continue;
                const [from, to] = bounds(r);
                if (sec >= from && sec < to) return n;
            }
        }
        return null;
    }

    function setState(ios, set, at) {
        const levels = [1, 2, 3, 4, 5, 6].filter((n) => ios[`${set}_level${n}`]).length;
        if (levels === 0) return undefined;
        const level = levelAt(ios, set, at);
        const off = set === 'cool' && values.get(ios.cool_default_off)?.state === 'true';
        const fallback = off ? null : number(ios[`${set}_default`]);
        return {
            levels,
            active_level: level,
            setpoint: level === null ? fallback : number(ios[`${set}_level${level}_setpoint`]),
            default: fallback,
        };
    }

    /** First instant after `at`, within a week, where a set changes level. */
    function nextChange(ios, set, at, enabled) {
        if (!enabled) return null;
        const now = levelAt(ios, set, at);
        const starts = new Set();
        for (let d = 0; d <= LOOKAHEAD_DAYS; d++) {
            const day = new Date(at.getFullYear(), at.getMonth(), at.getDate() + d);
            for (let n = 1; n <= 6; n++) {
                for (const r of timeranges.get(ios[`${set}_level${n}`])?.ranges ?? []) {
                    if (r.day !== String(isoDay(day))) continue;
                    for (const sec of bounds(r)) starts.add(day.getTime() + sec * 1000);
                }
            }
        }
        for (const t of [...starts].sort((a, b) => a - b)) {
            if (t <= at.getTime()) continue;
            const when = new Date(t);
            const level = levelAt(ios, set, when);
            if (level === now) continue;
            const off = set === 'cool' && values.get(ios.cool_default_off)?.state === 'true';
            const fallback = off ? null : number(ios[`${set}_default`]);
            return {
                at: isoWithOffset(when),
                set,
                level,
                setpoint: level === null ? fallback : number(ios[`${set}_level${level}_setpoint`]),
            };
        }
        return null;
    }

    return {
        reset,

        /** The wire `state.program` of a climate, or undefined while withheld or without levels. */
        programState(ios, mode) {
            if (hidden || !ios.program_enabled) return undefined;
            const at = clock ? new Date(clock) : new Date();
            const enabled = values.get(ios.program_enabled)?.state === 'true';
            const modeSet = mode === 'heat' || mode === 'cool' || mode === 'auto' ? mode : null;
            const out = { enabled, mode_set: modeSet };
            for (const set of ['heat', 'cool']) {
                const s = setState(ios, set, at);
                if (s) out[set] = s;
            }
            let next = null;
            const sets = modeSet === 'auto' ? ['heat', 'cool'] : modeSet ? [modeSet] : [];
            for (const set of sets) {
                const c = nextChange(ios, set, at, enabled);
                if (c && (!next || c.at < next.at)) next = c;
            }
            out.next_change = next;
            return out;
        },

        /** Test knobs: a fixed clock (ISO or null) and whether state.program is withheld. */
        configure({ clock: c, hidden: h } = {}) {
            if (c !== undefined) clock = c === null ? null : new Date(c).getTime();
            if (h !== undefined) hidden = Boolean(h);
            onChange();
        },

        has(id) {
            return values.has(id) || timeranges.has(id);
        },

        state(id) {
            return values.get(id)?.state;
        },

        /** @returns {boolean} set_state's success */
        setValue(id, value) {
            const io = values.get(id);
            if (!io) return false;
            const v = String(value);
            if (io.gui_type === 'var_bool' && v !== 'true' && v !== 'false') return false;
            if (io.gui_type === 'var_float' && !Number.isFinite(Number(v))) return false;
            if (io.state === v) return true;
            io.state = v;
            broadcast({ msg: 'event', data: { type_str: 'io_changed', data: { id, state: v } } });
            onChange();
            return true;
        },

        getTimerange(id) {
            const tr = timeranges.get(id);
            if (!tr) return { error: 'wrong input' };
            return { months: tr.months, ranges: tr.ranges.map((r) => ({ ...r })) };
        },

        /** Answers what the server would put in `data`. */
        setTimerange(data) {
            const id = data?.id;
            const tr = typeof id === 'string' ? timeranges.get(id) : undefined;
            if (!tr) return { error: 'wrong input' };
            if (data.months !== undefined && !(typeof data.months === 'string' && /^[01]{12}$/.test(data.months))) {
                return { error: 'invalid months' };
            }
            let ranges = tr.ranges;
            if (data.ranges !== undefined) {
                const checked = validateRanges(data.ranges);
                if (checked.error) return { error: checked.error };
                ranges = checked.ranges;
            }
            tr.ranges = ranges;
            if (data.months !== undefined) tr.months = data.months;
            onChange();
            broadcast({
                msg: 'event',
                data: {
                    data: { id },
                    event_raw: `timerange_changed id:${id}`,
                    type: '9',
                    type_str: 'timerange_changed',
                },
            });
            if (failAfter === 0) {
                failAfter = -1;
                return { error: 'config_not_written' };
            }
            if (failAfter > 0) failAfter--;
            return { success: 'true' };
        },

        /** The (n+1)th set_timerange from now answers config_not_written. */
        failWrite(after = 0) {
            failAfter = Math.max(0, Math.trunc(Number(after) || 0));
        },
    };
}
