// Mutable home state for the mock calaos_server.
//
// Holds a mutable clone of fixtures/home.json, applies naive `set_state`
// transitions and hands the resulting `io_changed` event to the injected
// `broadcast` callback. Everything on the wire is a STRING (see
// docs/ARCHITECTURE.md "Protocol layer") — every value written here stays a
// string on purpose.

import { readFileSync } from 'node:fs';

const FIXTURE_URL = new URL('./fixtures/home.json', import.meta.url);

/** Re-read (not cache) so `/control {op:'reset'}` also picks up fixture edits. */
function loadFixture() {
    return JSON.parse(readFileSync(FIXTURE_URL, 'utf8'));
}

/** Wire event frame for a single IO state change. */
export function ioChangedEvent(id, state) {
    return {
        msg: 'event',
        data: {
            type_str: 'io_changed',
            data: { id, state },
        },
    };
}

/** Clamp to the 0-100 range calaos uses for dimmers / shutter percentages. */
function clampPercent(n) {
    if (!Number.isFinite(n)) return 0;
    return String(Math.min(100, Math.max(0, Math.round(n))));
}

/** Parse `'up 30'` / `'down 100'` / `'stop 55'` into its two parts. */
function parseShutterSmart(state) {
    const match = /^(up|down|stop)\s+(-?\d+)$/.exec(String(state).trim());
    if (!match) return { action: 'stop', percent: 0 };
    return { action: match[1], percent: Number(match[2]) };
}

/** Percentage carried by a dimmer state (`'42'`, `'set 42'`, `'true'`, `'false'`). */
function parseDimmer(state) {
    const s = String(state).trim();
    if (s === 'true') return 100;
    if (s === 'false') return 0;
    const setMatch = /^set\s+(-?\d+)$/.exec(s);
    if (setMatch) return Number(setMatch[1]);
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? 0 : n;
}

function parseNumber(state) {
    const n = parseFloat(state);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Naive per-gui_type transition: given the current IO and the `set_state`
 * value, return the new state string, or `null` when the value is a no-op
 * (unknown action, read-only IO type, scenario trigger).
 *
 * `lastColor` is the last non-black colour seen for a light_rgb IO, used to
 * restore it on `'true'`. It is kept outside the IO object so nothing but the
 * fixture's own fields ever reaches the wire.
 *
 * Deliberate deviations from a "value becomes state" passthrough, so the mock
 * stays consistent with the parsers in docs/ARCHITECTURE.md:
 *  - `shutter` state is `'true'`/`'false'` (open/closed), so up/down map onto
 *    those rather than being stored verbatim.
 *  - `shutter_smart` recomposes `'<action> <pct>'`: up drives to 0 (open),
 *    down to 100 (closed), stop freezes the current percentage.
 *  - `scenario` is fire-and-forget: no state change, hence no broadcast (the
 *    frame is still recorded in the /control log).
 */
export function nextState(io, value, lastColor = '#ffffff') {
    const v = String(value);
    const current = String(io.state ?? '');

    switch (io.gui_type) {
        // Read-only types: nothing a client sends can change them.
        case 'temp':
        case 'analog_in':
        case 'string_in':
            return null;

        case 'light':
        case 'var_bool':
            return v === 'true' || v === 'false' ? v : null;

        case 'light_dimmer': {
            if (v === 'true') return '100';
            if (v === 'false') return '0';
            const setMatch = /^set\s+(-?\d+)$/.exec(v);
            if (setMatch) return clampPercent(Number(setMatch[1]));
            if (/^-?\d+$/.test(v)) return clampPercent(Number(v));
            if (v === 'inc') return clampPercent(parseDimmer(current) + 10);
            if (v === 'dec') return clampPercent(parseDimmer(current) - 10);
            return null;
        }

        case 'light_rgb': {
            const setColor = /^set\s+(#[0-9a-fA-F]{6})$/.exec(v);
            if (setColor) return setColor[1].toLowerCase();
            if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
            // 'false' means off; remember the colour so 'true' can restore it.
            if (v === 'false') return '#000000';
            if (v === 'true') {
                const isOff = current === '0' || current === '#000000' || current === '';
                return isOff ? lastColor : current;
            }
            return null;
        }

        case 'shutter':
            if (v === 'up' || v === 'true') return 'true';
            if (v === 'down' || v === 'false') return 'false';
            return null; // 'stop' freezes: no observable change

        case 'shutter_smart': {
            const { percent } = parseShutterSmart(current);
            if (v === 'up') return 'up 0';
            if (v === 'down') return 'down 100';
            if (v === 'stop') return `stop ${clampPercent(percent)}`;
            const setMatch = /^set\s+(-?\d+)$/.exec(v);
            if (setMatch) return `stop ${clampPercent(Number(setMatch[1]))}`;
            return null;
        }

        case 'var_int':
        case 'analog_out': {
            if (v === 'inc') return String(parseNumber(current) + 1);
            if (v === 'dec') return String(parseNumber(current) - 1);
            const setMatch = /^set\s+(-?\d+(?:\.\d+)?)$/.exec(v);
            if (setMatch) return String(Number(setMatch[1]));
            if (/^-?\d+(?:\.\d+)?$/.test(v)) return String(Number(v));
            return null;
        }

        // Raw text, no prefix (docs/ARCHITECTURE.md IO state parser table).
        case 'var_string':
        case 'string_out':
            return v;

        case 'scenario':
            return null;

        default:
            return null;
    }
}

/**
 * @param {{ broadcast?: (frame: object) => void }} [options]
 *   `broadcast` receives ready-to-send wire frames; the transport lives in
 *   index.mjs so this module stays testable on its own.
 */
export function createState({ broadcast = () => {} } = {}) {
    /** @type {{home: object[], cameras: object[], audio: object[]}} */
    let home;
    /** @type {Map<string, object>} */
    let ios;
    /** Last non-black colour per light_rgb id — never serialised to the wire. */
    let lastColors;

    function reindex() {
        ios = new Map();
        lastColors = new Map();
        for (const room of home.home ?? []) {
            for (const io of room.items ?? []) ios.set(io.id, io);
        }
    }

    function reset() {
        home = loadFixture();
        reindex();
    }

    reset();

    return {
        reset,

        /** The `get_home` payload: `{home, cameras, audio}`. */
        getHome() {
            return home;
        },

        getIo(id) {
            return ios.get(id);
        },

        getCamera(id) {
            return (home.cameras ?? []).find((camera) => camera.id === id);
        },

        ioIds() {
            return [...ios.keys()];
        },

        /**
         * Force an IO to a state and broadcast it, no transition rules applied
         * (`/control {op:'push_io'}`). Unknown ids are still broadcast so E2E
         * can exercise the client's handling of events for unknown IOs.
         * @returns {boolean} whether the id exists in the fixture
         */
        pushIo(id, state) {
            const io = ios.get(id);
            const next = String(state);
            if (io) io.state = next;
            broadcast(ioChangedEvent(id, next));
            return Boolean(io);
        },

        /**
         * Apply a `set_state` value. Broadcasts `io_changed` to every client
         * when (and only when) the state actually changed.
         * @returns {{id: string, state: string} | null} the applied change
         */
        applySetState(id, value) {
            const io = ios.get(id);
            if (!io) return null;

            const next = nextState(io, value, lastColors.get(id) ?? '#ffffff');
            if (next === null || next === io.state) return null;

            // Remember the last lit colour so light_rgb 'true' can restore it.
            if (io.gui_type === 'light_rgb' && io.state !== '0' && io.state !== '#000000') {
                lastColors.set(id, io.state);
            }

            io.state = next;
            broadcast(ioChangedEvent(id, next));
            return { id, state: next };
        },
    };
}
