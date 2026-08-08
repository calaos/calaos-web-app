import { describe, expect, it } from 'vitest';
import {
    ACTION_DEC,
    ACTION_DOWN,
    ACTION_FALSE,
    ACTION_INC,
    ACTION_STOP,
    ACTION_TRUE,
    ACTION_UP,
    parseAnalogIn,
    parseAnalogOut,
    parseLight,
    parseLightDimmer,
    parseLightRgb,
    parseScenario,
    parseShutter,
    parseShutterSmart,
    parseStringIn,
    parseStringOut,
    parseTemp,
    parseUnknown,
    parseVarBool,
    parseVarInt,
    parseVarString,
    setColor,
    setPercent,
    setText,
} from './io-states';

describe('action verbs and set_state value builders', () => {
    it('verb constants are the exact wire strings', () => {
        expect(ACTION_TRUE).toBe('true');
        expect(ACTION_FALSE).toBe('false');
        expect(ACTION_UP).toBe('up');
        expect(ACTION_DOWN).toBe('down');
        expect(ACTION_STOP).toBe('stop');
        expect(ACTION_INC).toBe('inc');
        expect(ACTION_DEC).toBe('dec');
    });

    it.each([
        [0, 'set 0'],
        [50, 'set 50'],
        [100, 'set 100'],
    ])('setPercent(%d) → %o ("set " prefix)', (n, expected) => {
        expect(setPercent(n)).toBe(expected);
    });

    it.each([
        ['#ff2200', 'set #ff2200'],
        ['#000000', 'set #000000'],
    ])('setColor(%o) → %o ("set " prefix)', (hex, expected) => {
        expect(setColor(hex)).toBe(expected);
    });

    it.each([
        ['hello world', 'hello world'],
        ['', ''],
        ['set in stone', 'set in stone'],
    ])('setText(%o) → %o (RAW, no prefix)', (text, expected) => {
        expect(setText(text)).toBe(expected);
    });
});

describe('parseTemp', () => {
    it.each([
        ['21.5', '°C', '21.5 °C'],
        // Deliberate fix: old template hardcoded °C; unit is used when present…
        ['70', '°F', '70 °F'],
        // …and °C stays the fallback when the server sends no unit.
        ['21.5', '', '21.5 °C'],
    ])('state %o unit %o → display %o', (state, unit, display) => {
        expect(parseTemp(state, unit)).toEqual({ display });
    });
});

describe('parseAnalogIn', () => {
    it.each([
        ['1250', 'W', 'energy', { display: '1250 W', icon: 'energy' }],
        ['42', '', '', { display: '42', icon: 'default' }],
        ['0.5', 'bar', 'water', { display: '0.5 bar', icon: 'water' }],
    ])('state %o unit %o gui_style %o → %o', (state, unit, ioStyle, expected) => {
        expect(parseAnalogIn(state, unit, ioStyle)).toEqual(expected);
    });
});

describe('parseStringIn', () => {
    it.each([
        // Empty state falls back to the IO name (old VarStringCtrl).
        ['', 'Doorbell', 'Doorbell'],
        ['ding dong', 'Doorbell', 'ding dong'],
    ])('state %o name %o → display %o', (state, name, display) => {
        expect(parseStringIn(state, name)).toEqual({ display });
    });
});

describe('parseLight', () => {
    it.each([
        ['true', true],
        ['false', false],
        ['', false],
        ['1', false],
    ])('state %o → on %s (only the exact string "true")', (state, on) => {
        expect(parseLight(state)).toEqual({ on });
    });
});

describe('parseAnalogOut', () => {
    it.each([
        ['30', '%', 'heating', { display: '30 %', icon: 'heating' }],
        ['7', '', '', { display: '7', icon: 'default' }],
    ])('state %o unit %o gui_style %o → %o', (state, unit, ioStyle, expected) => {
        expect(parseAnalogOut(state, unit, ioStyle)).toEqual(expected);
    });
});

describe('parseLightDimmer', () => {
    it.each([
        // 1. bare numeric state wins first (isNaN(parseInt) check FIRST)…
        ['42', 42, true],
        ['0', 0, false],
        ['100', 100, true],
        // …parseInt('42.7') truncates like the old parseInt
        ['42.7', 42, true],
        // 2. parseInt('set 50') is NaN, so 'set N' is parsed by the prefix branch
        ['set 50', 50, true],
        ['set 0', 0, false],
        ['set 100', 100, true],
        // 3. bare booleans
        ['true', 100, true],
        ['false', 0, false],
        // anything else keeps the initial 0
        ['', 0, false],
        ['off', 0, false],
        // exact 'set ' prefix required (4 chars incl. space)
        ['set50', 0, false],
    ])('state %o → percent %d, on %s', (state, percent, on) => {
        expect(parseLightDimmer(state)).toEqual({ percent, on });
    });

    it('preserves the old NaN result for "set <garbage>" (never sent by the real server)', () => {
        const vm = parseLightDimmer('set junk');
        expect(Number.isNaN(vm.percent)).toBe(true);
        expect(vm.on).toBe(false); // NaN > 0 was false in the old code too
    });
});

describe('parseLightRgb', () => {
    it.each([
        // '0' → black shorthand, off
        ['0', '#000', false],
        // '#000000' keeps its literal color but counts as off
        ['#000000', '#000000', false],
        ['#ff2200', '#ff2200', true],
        ['#ffffff', '#ffffff', true],
    ])('state %o → color %o, on %s', (state, color, on) => {
        expect(parseLightRgb(state)).toEqual({ color, on });
    });

    it('preserves the old quirk: any other string (even empty) counts as on', () => {
        expect(parseLightRgb('')).toEqual({ color: '', on: true });
    });
});

describe('parseShutter', () => {
    it.each([
        ['true', true],
        ['false', false],
        ['', false],
    ])('state %o → open %s', (state, open) => {
        expect(parseShutter(state)).toEqual({ open });
    });
});

describe('parseShutterSmart', () => {
    it.each([
        // 'up 100' → fully open command completed → indicator NOT open
        ['up 100', 'up', 100, false],
        ['stop 30', 'stop', 30, true],
        ['down 0', 'down', 0, true],
        ['down 100', 'down', 100, false],
        ['up 42', 'up', 42, true],
        // percent may be missing entirely → NaN → 0 → open
        ['up', 'up', 0, true],
        ['stop', 'stop', 0, true],
        ['down', 'down', 0, true],
        // NUMERIC compare fix: old code compared the raw STRING ('abc' < 100
        // is NaN-false → shown closed); now unparseable percent → 0 → open
        ['up abc', 'up', 0, true],
        // no known prefix → no action, percent 0 (old default v = '0'), open
        ['garbage', null, 0, true],
        ['', null, 0, true],
    ])('state %o → action %o, percent %d, open %s', (state, action, percent, open) => {
        expect(parseShutterSmart(state)).toEqual({ action, percent, open });
    });
});

describe('parseVarBool', () => {
    it.each([
        ['true', true],
        ['false', false],
        ['yes', false],
    ])('state %o → checked %s', (state, checked) => {
        expect(parseVarBool(state)).toEqual({ checked });
    });
});

describe('parseVarInt', () => {
    it.each([
        ['5', 'items', '5 items'],
        ['12', '', '12'],
    ])('state %o unit %o → display %o', (state, unit, display) => {
        expect(parseVarInt(state, unit)).toEqual({ display });
    });
});

describe('parseVarString', () => {
    it.each([
        // Empty state → show the IO name instead (old VarStringCtrl)
        ['', 'Message board', 'Message board'],
        ['Hello!', 'Message board', 'Hello!'],
        // A single space is NOT empty — displayed as-is, like the old == ''
        [' ', 'Message board', ' '],
    ])('state %o name %o → display %o', (state, name, display) => {
        expect(parseVarString(state, name)).toEqual({ display });
    });
});

describe('parseStringOut', () => {
    it.each([
        ['', 'Ticker', 'Ticker'],
        ['breaking news', 'Ticker', 'breaking news'],
    ])('state %o name %o → display %o (same rule as var_string)', (state, name, display) => {
        expect(parseStringOut(state, name)).toEqual({ display });
    });
});

describe('parseScenario', () => {
    it.each([['Cinema'], ['Leaving home']])('shows the name only (%o)', (name) => {
        expect(parseScenario(name)).toEqual({ display: name });
    });
});

describe('parseUnknown', () => {
    it.each([
        ['12', 'Mystery IO', 'gauge', { display: 'Mystery IO', state: '12', icon: 'gauge' }],
        ['', 'No style', '', { display: 'No style', state: '', icon: 'default' }],
    ])('state %o name %o gui_style %o → %o', (state, name, ioStyle, expected) => {
        expect(parseUnknown(state, name, ioStyle)).toEqual(expected);
    });
});
