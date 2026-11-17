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

/**
 * @param {{ broadcast?: (frame: object) => void }} [options]
 */
export function createProgram({ broadcast = () => {} } = {}) {
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
    }
    reset();

    return {
        reset,

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
