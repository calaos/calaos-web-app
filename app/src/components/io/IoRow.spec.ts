import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import AnalogInIo from './AnalogInIo.vue';
import AnalogOutIo from './AnalogOutIo.vue';
import IoRow, { IO_COMPONENTS, NOT_IMPLEMENTED_GUI_TYPES } from './IoRow.vue';
import LightDimmerIo from './LightDimmerIo.vue';
import LightIo from './LightIo.vue';
import LightRgbIo from './LightRgbIo.vue';
import ScenarioIo from './ScenarioIo.vue';
import ShutterIo from './ShutterIo.vue';
import ShutterSmartIo from './ShutterSmartIo.vue';
import StringInIo from './StringInIo.vue';
import TempIo from './TempIo.vue';
import UnknownIo from './UnknownIo.vue';
import VarBoolIo from './VarBoolIo.vue';
import VarIntIo from './VarIntIo.vue';
import VarStringIo from './VarStringIo.vue';
import en from '../../i18n/en.json';
import { toIoItem } from '../../protocol/guards';
import { GUI_TYPES } from '../../protocol/types';
import { useHomeStore } from '../../stores/home';
import type { WireIo } from '../../protocol/types';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });

/** The full dispatch surface: the 14 wire types plus the fallback. */
const ALL_KEYS = [...GUI_TYPES, 'unknown'] as const;

/** The types that have a component of their own today. */
const IMPLEMENTED = {
    temp: TempIo,
    analog_in: AnalogInIo,
    string_in: StringInIo,
    light: LightIo,
    var_bool: VarBoolIo,
    scenario: ScenarioIo,
    shutter: ShutterIo,
    shutter_smart: ShutterSmartIo,
    light_rgb: LightRgbIo,
    // One component, two wire types.
    var_string: VarStringIo,
    string_out: VarStringIo,
    analog_out: AnalogOutIo,
    var_int: VarIntIo,
    light_dimmer: LightDimmerIo,
} as const;

/** The only types that put a control in the row (when `rw` allows it). */
const ACTIONABLE = new Set<string>([
    'light',
    'var_bool',
    'scenario',
    'shutter',
    'shutter_smart',
    'light_rgb',
    'var_string',
    'string_out',
    'analog_out',
    'var_int',
    'light_dimmer',
]);

function mountRow(wire: WireIo) {
    const io = toIoItem({ id: 'io_1', name: 'Un objet', visible: 'true', rw: 'true', ...wire });
    return mount(IoRow, { props: { io }, global: { plugins: [i18n] } });
}

beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    useHomeStore().attachTransport(() => true);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('IoRow — the dispatch table', () => {
    it('has an entry for all 14 gui_types and for the unknown fallback', () => {
        expect(ALL_KEYS).toHaveLength(15);
        expect(Object.keys(IO_COMPONENTS).sort()).toEqual([...ALL_KEYS].sort());
        for (const key of ALL_KEYS) {
            expect(IO_COMPONENTS[key]).toBeDefined();
        }
    });

    it('points the built types at their own component', () => {
        for (const [guiType, component] of Object.entries(IMPLEMENTED)) {
            expect(IO_COMPONENTS[guiType as keyof typeof IO_COMPONENTS]).toBe(component);
        }
    });

    it('parks the types whose controls land in T11-T13 on the placeholder', () => {
        for (const guiType of NOT_IMPLEMENTED_GUI_TYPES) {
            expect(IO_COMPONENTS[guiType]).toBe(UnknownIo);
        }
        // Every gui_type is either built or on the list — and nothing can be
        // on the list twice or be quietly parked without being listed.
        const parked = ALL_KEYS.filter(
            (key) => key !== 'unknown' && IO_COMPONENTS[key] === UnknownIo,
        );
        expect([...parked].sort()).toEqual([...NOT_IMPLEMENTED_GUI_TYPES].sort());
        expect(Object.keys(IMPLEMENTED)).toHaveLength(GUI_TYPES.length - parked.length);
    });

    it('sends an unrecognized gui_type to the unknown row', () => {
        expect(IO_COMPONENTS.unknown).toBe(UnknownIo);
        expect(mountRow({ gui_type: 'not_a_type' }).findComponent(UnknownIo).exists()).toBe(true);
    });
});

describe('IoRow — what it renders', () => {
    it('renders exactly one row, of the right kind, for every gui_type', () => {
        for (const guiType of ALL_KEYS) {
            const wrapper = mountRow({ gui_type: guiType, state: '1' });

            expect(wrapper.findAll('.io-row')).toHaveLength(1);
            expect(wrapper.get('.io-row__name').text()).toBe('Un objet');
            expect(wrapper.findComponent(IO_COMPONENTS[guiType]).exists()).toBe(true);
        }
    });

    it('offers no control at all for any type when rw is false', () => {
        // The uniform gate (docs/ARCHITECTURE.md): the old app applied `rw`
        // inconsistently — var_bool honoured it, light and analog_out did not.
        for (const guiType of ALL_KEYS) {
            const wrapper = mountRow({ gui_type: guiType, state: 'true', rw: 'false' });

            expect(wrapper.findAll('button')).toHaveLength(0);
            expect(wrapper.find('.io-row__actions').exists()).toBe(false);
        }
    });

    it('offers controls only for the types that have a verb', () => {
        for (const guiType of ALL_KEYS) {
            const wrapper = mountRow({ gui_type: guiType, state: 'true' });
            const buttons = wrapper.findAll('button').length;

            expect(buttons > 0).toBe(ACTIONABLE.has(guiType));
        }
    });

    it('draws an invisible IO all the same — that gate belongs to the list', () => {
        // `visible === false` means never rendered, but it is RoomView that
        // filters (see RoomView.spec.ts). A row asked to draw itself draws
        // itself; splitting the check across both would let one of them rot.
        const wrapper = mountRow({ gui_type: 'light', state: 'true', visible: 'false' });

        expect(wrapper.findAll('.io-row')).toHaveLength(1);
    });
});
