import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import ClimateIo from './ClimateIo.vue';
import en from '../../i18n/en.json';
import fr from '../../i18n/fr.json';
import { toHomeData } from '../../protocol/guards';
import { useHomeStore } from '../../stores/home';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en, fr } });
const NAME = 'Clim salon';

const t = (key: string, values: Record<string, string> = { name: NAME }): string =>
    i18n.global.t(key, values);

type Wire = Record<string, unknown>;

const FULL_CAPS = {
    modes: ['off', 'heat', 'cool', 'auto', 'dry', 'fan_only'],
    target_temp: { min: 16, max: 30, step: 0.5, unit: '°C', min_range: 2 },
    target_temp_range: true,
    fan_modes: ['auto', 'low', 'high'],
    swing_modes: ['off', 'vertical'],
    reports_action: true,
    remote_temp: true,
};

const FULL_STATE = {
    mode: 'heat',
    current_temp: 23.4,
    target_temp: 21,
    target_temp_low: 19,
    target_temp_high: 24,
    action: 'heating',
    fan_mode: 'auto',
    swing_mode: 'off',
};

function wireDevice(caps: Wire = {}, state: Wire = {}, ios: Wire = { mode: 'm', target_temp: 't' }) {
    return {
        family: 'climate',
        impl: 'proxy',
        capabilities: { ...FULL_CAPS, ...caps },
        state: { ...FULL_STATE, ...state },
        ios,
    };
}

/** A `caps`/`state` key set to `undefined` is removed, so a capability can be absent. */
function without(obj: Wire, ...keys: string[]): Wire {
    const copy = { ...obj };
    for (const key of keys) delete copy[key];
    return copy;
}

let sent: string[];

/** The `value` of every set_state the component put on the wire. */
const values = (): string[] => sent.map((frame) => JSON.parse(frame).data.value as string);

function mountClimate(device: Wire | null = wireDevice(), wire: Wire = {}) {
    const home = useHomeStore();
    home.setHome(
        toHomeData({
            home: [
                {
                    name: 'Salon',
                    items: [
                        {
                            id: 'clim',
                            name: NAME,
                            gui_type: 'climate',
                            state: 'heat',
                            visible: 'true',
                            ...(device ? { device } : {}),
                            ...wire,
                        },
                    ],
                },
            ],
        }),
    );
    const io = home.ios.get('clim')!;
    return mount(ClimateIo, { props: { io }, global: { plugins: [i18n] } });
}

/** One tick of a slider drag: only `input`, like a real pointer drag. */
async function dragTo(input: Omit<DOMWrapper<Element>, 'exists'>, value: number) {
    (input.element as HTMLInputElement).value = String(value);
    await input.trigger('input');
}

/** A keyboard step or a release: `input` then `change`. */
async function setTo(input: Omit<DOMWrapper<Element>, 'exists'>, value: number) {
    await dragTo(input, value);
    await input.trigger('change');
}

const modeButton = (w: VueWrapper, label: string) =>
    w.findAll('.climate-io__mode').find((b) => b.text() === label)!;

const slider = (w: VueWrapper, label: string) =>
    w.get(`input[type="range"][aria-label="${label}"]`);

const changed = (device: Wire) =>
    useHomeStore().handleEvent({
        kind: 'io_changed',
        id: 'clim',
        device: toHomeData({ home: [{ items: [{ id: 'x', device }] }] }).rooms[0].items[0].device,
    });

beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    sent = [];
    useHomeStore().attachTransport((frame) => {
        sent.push(frame);
        return true;
    });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('ClimateIo — mode buttons', () => {
    it('draws one labelled button per mode in capabilities.modes, and no others', () => {
        const w = mountClimate(wireDevice({ modes: ['off', 'heat', 'cool'] }));

        expect(w.findAll('.climate-io__mode').map((b) => b.text())).toEqual(['Off', 'Heat', 'Cool']);
        expect(w.get('[role="group"]').attributes('aria-label')).toBe(t('climate.modes'));
    });

    it('presses the current mode only', () => {
        const w = mountClimate(wireDevice({}, { mode: 'cool' }));

        const pressed = w.findAll('.climate-io__mode').filter((b) => b.attributes('aria-pressed') === 'true');
        expect(pressed.map((b) => b.text())).toEqual(['Cool']);
    });

    it('sends a plain mode, not JSON, and marks the row pending until the answer', async () => {
        const w = mountClimate();

        await modeButton(w, 'Cool').trigger('click');

        expect(values()).toEqual(['cool']);
        expect(w.find('.io-row__pending').exists()).toBe(true);

        changed(wireDevice({}, { mode: 'cool' }));
        await w.vm.$nextTick();
        expect(w.find('.io-row__pending').exists()).toBe(false);
        expect(modeButton(w, 'Cool').attributes('aria-pressed')).toBe('true');
    });

    it('does not resend the mode it is already in', async () => {
        const w = mountClimate();
        await modeButton(w, 'Heat').trigger('click');
        expect(sent).toEqual([]);
    });

    it('sends a setpoint chosen just before a mode change first, so the mode cannot overtake it', async () => {
        const w = mountClimate();
        await setTo(slider(w, t('climate.target')), 23);
        await modeButton(w, 'Cool').trigger('click');

        expect(values()).toEqual(['{"target_temp":23}', 'cool']);
    });

    it('translates the mode names', async () => {
        i18n.global.locale.value = 'fr';
        try {
            const w = mountClimate(wireDevice({ modes: ['off', 'fan_only'] }));
            expect(w.findAll('.climate-io__mode').map((b) => b.text())).toEqual(['Arrêt', 'Ventilation']);
        } finally {
            i18n.global.locale.value = 'en';
        }
    });
});

describe('ClimateIo — capabilities present and absent', () => {
    it('shows every control for a full device', () => {
        const w = mountClimate(wireDevice({}, { mode: 'heat' }));

        expect(w.findAll('input[type="range"]')).toHaveLength(1);
        expect(w.findAll('select')).toHaveLength(2);
        expect(w.find('.climate-io__chip').text()).toBe('Heating');
        expect(w.get('.climate-io__target').text()).toBe('21.0 °C');
    });

    it('has no setpoint without a target_temp capability', () => {
        const w = mountClimate(wireDevice({ target_temp: undefined, target_temp_range: undefined }));

        expect(w.find('.climate-io__setpoint').exists()).toBe(false);
        expect(w.find('input[type="range"]').exists()).toBe(false);
    });

    it('has no fan or swing selector unless the capability lists options', () => {
        const none = mountClimate(wireDevice({ fan_modes: undefined, swing_modes: undefined }));
        expect(none.find('select').exists()).toBe(false);

        const fanOnly = mountClimate(wireDevice({ swing_modes: undefined }));
        expect(fanOnly.findAll('select')).toHaveLength(1);
        expect(fanOnly.get('select').attributes('aria-label')).toBe(t('climate.fanOf'));

        const swingOnly = mountClimate(wireDevice({ fan_modes: [] }));
        expect(swingOnly.findAll('select')).toHaveLength(1);
        expect(swingOnly.get('select').attributes('aria-label')).toBe(t('climate.swingOf'));
    });

    it('shows the action badge only when the device reports an action', () => {
        expect(mountClimate().find('.climate-io__chip').exists()).toBe(true);

        const noCap = mountClimate(wireDevice({ reports_action: undefined }));
        expect(noCap.find('.climate-io__chip').exists()).toBe(false);

        // Capable, but no value received yet: absent, not a made-up "Idle".
        const noValue = mountClimate(wireDevice({}, {}, { mode: 'm' }));
        expect(noValue.findAll('.climate-io__chip')).toHaveLength(1);
        const unseen = mountClimate({
            ...wireDevice(),
            state: without(FULL_STATE, 'action'),
        });
        expect(unseen.find('.climate-io__chip').exists()).toBe(false);
    });

    it('lights the glyph and the badge only while the device is acting', () => {
        const heating = mountClimate(wireDevice({}, { action: 'heating' }));
        expect(heating.get('.climate-io__icon').classes()).toContain('climate-io__icon--on');
        expect(heating.get('.climate-io__chip').classes()).toContain('climate-io__chip--active');

        const idle = mountClimate(wireDevice({}, { action: 'idle' }));
        expect(idle.get('.climate-io__icon').classes()).not.toContain('climate-io__icon--on');
        expect(idle.get('.climate-io__chip').text()).toBe('Idle');
    });

    it('shows the options the server lists, translated, and the current one selected', () => {
        const w = mountClimate(wireDevice({}, { fan_mode: 'low' }));
        const fan = w.get('select');

        expect(fan.findAll('option').map((o) => o.text())).toEqual(['Auto', 'Low', 'High']);
        expect((fan.element as HTMLSelectElement).value).toBe('low');
    });

    it('keeps an option it has no translation for, and a value outside the list', () => {
        const w = mountClimate(wireDevice({ fan_modes: ['turbo'] }, { fan_mode: 'ludicrous' }));

        expect(w.get('select').findAll('option').map((o) => o.text())).toEqual(['turbo', 'ludicrous']);
    });

    it('shows a placeholder when the fan mode was never received', () => {
        const w = mountClimate({ ...wireDevice(), state: without(FULL_STATE, 'fan_mode') });

        const placeholder = w.get('select option');
        expect(placeholder.text()).toBe('—');
        expect(placeholder.attributes('disabled')).toBeDefined();
    });
});

describe('ClimateIo — current temperature', () => {
    it('reads out the current temperature with the unit', () => {
        const w = mountClimate();

        expect(w.get('.climate-io__current').text()).toContain('23.4 °C');
        expect(w.get('.climate-io__current .visually-hidden').text()).toBe(t('climate.current'));
    });

    it('shows a dash, announced as unknown, when it was never received', () => {
        const w = mountClimate({ ...wireDevice(), state: without(FULL_STATE, 'current_temp') });

        expect(w.get('.climate-io__current').text()).toContain('—');
        expect(w.get('.climate-io__current .visually-hidden').text()).toBe(t('climate.currentUnknown'));
    });
});

describe('ClimateIo — gating by mode', () => {
    const interactive = (w: VueWrapper) => [
        ...w.findAll('input[type="range"]'),
        ...w.findAll('select'),
        ...w.findAll('.action-button'),
    ];

    it('greys and disables setpoint, fan and swing when off, but keeps the mode buttons live', () => {
        const w = mountClimate(wireDevice({}, { mode: 'off' }));

        expect(w.get('.climate-io__setpoint').classes()).toContain('climate-io__setpoint--off');
        expect(interactive(w)).toHaveLength(5);
        for (const control of interactive(w)) {
            expect((control.element as HTMLInputElement).disabled).toBe(true);
        }
        for (const button of w.findAll('.climate-io__mode')) {
            expect((button.element as HTMLButtonElement).disabled).toBe(false);
        }
    });

    it('greys the range and both handles when off on a range device', () => {
        const w = mountClimate(wireDevice({}, { mode: 'off', target_temp: undefined }, { mode: 'm' }));

        const handles = w.findAll('input[type="range"]');
        expect(handles).toHaveLength(2);
        expect(handles.every((h) => (h.element as HTMLInputElement).disabled)).toBe(true);
    });

    it('hides the setpoint in fan_only but keeps fan and swing usable', () => {
        const w = mountClimate(wireDevice({}, { mode: 'fan_only' }));

        expect(w.find('.climate-io__setpoint').exists()).toBe(false);
        expect(w.findAll('select')).toHaveLength(2);
        expect(w.findAll('select').every((s) => !(s.element as HTMLSelectElement).disabled)).toBe(true);
    });

    it.each(['heat', 'cool', 'dry'])('shows one live slider in %s', (mode) => {
        const w = mountClimate(wireDevice({}, { mode }));

        expect(w.findAll('input[type="range"]')).toHaveLength(1);
        expect((w.get('input[type="range"]').element as HTMLInputElement).disabled).toBe(false);
    });

    it('shows the two-handle range in auto when the device has a range', () => {
        const w = mountClimate(wireDevice({}, { mode: 'auto' }));

        expect(w.findAll('input[type="range"]').map((i) => i.attributes('aria-label'))).toEqual([
            t('climate.targetLow'),
            t('climate.targetHigh'),
        ]);
        expect(w.get('.climate-io__target').text()).toBe('19.0 – 24.0 °C');
    });

    it('keeps a single slider in auto when the device has no range', () => {
        const w = mountClimate(wireDevice({ target_temp_range: false }, { mode: 'auto' }));

        expect(w.findAll('input[type="range"]')).toHaveLength(1);
    });

    it('offers no setpoint in heat on a range-only device', () => {
        const w = mountClimate(wireDevice({}, { mode: 'heat', target_temp: undefined }, { mode: 'm' }));

        expect(w.find('.climate-io__setpoint').exists()).toBe(false);
    });
});

describe('ClimateIo — unknown mode', () => {
    it('shows "unknown", presses nothing, and keeps working', async () => {
        const w = mountClimate({ ...wireDevice(), state: without(FULL_STATE, 'mode') }, { state: '' });

        expect(w.find('.climate-io__chip--unknown').text()).toBe(t('climate.mode.unknown'));
        expect(w.findAll('.climate-io__mode').every((b) => b.attributes('aria-pressed') === 'false')).toBe(true);

        await modeButton(w, 'Heat').trigger('click');
        expect(values()).toEqual(['heat']);
    });

    it('is not "off": controls stay enabled', () => {
        const w = mountClimate({ ...wireDevice(), state: without(FULL_STATE, 'mode') });

        expect(w.get('.climate-io__setpoint').classes()).not.toContain('climate-io__setpoint--off');
        expect((w.get('select').element as HTMLSelectElement).disabled).toBe(false);
    });

    it('treats an empty-string mode the same way', () => {
        const w = mountClimate(wireDevice({}, { mode: '' }));

        expect(w.find('.climate-io__chip--unknown').exists()).toBe(true);
    });

    it('names a mode that is not among the buttons instead of hiding it', () => {
        const w = mountClimate(wireDevice({ modes: ['off', 'heat'] }, { mode: 'cool' }));

        expect(w.get('.climate-io__chip--unknown').text()).toBe('Cool');
    });

    it('survives a device with nothing at all in it', () => {
        const w = mountClimate({ family: 'climate', impl: '' });

        expect(w.get('.io-row__name').text()).toBe(NAME);
        expect(w.find('.climate-io__mode').exists()).toBe(false);
        expect(w.find('.climate-io__setpoint').exists()).toBe(false);
        expect(w.find('.climate-io__chip--unknown').exists()).toBe(true);
    });
});

describe('ClimateIo — without a usable device', () => {
    it('shows the name and the scalar state, no controls', () => {
        const w = mountClimate(null);

        expect(w.get('.io-row__name').text()).toBe(NAME);
        expect(w.get('.io-row__value').text()).toBe('heat');
        expect(w.find('button').exists()).toBe(false);
        expect(w.find('.io-row__panel').exists()).toBe(false);
    });

    it('ignores a device of another family', () => {
        const w = mountClimate({ ...wireDevice(), family: 'fan' });

        expect(w.find('.io-row__panel').exists()).toBe(false);
    });
});

describe('ClimateIo — single setpoint commands', () => {
    it('sends one JSON partial update per drag, after the quiet period', async () => {
        const w = mountClimate();
        const input = slider(w, t('climate.target'));

        await input.trigger('pointerdown', { pointerType: 'mouse' });
        await dragTo(input, 22);
        await dragTo(input, 24.5);
        await dragTo(input, 25);
        vi.advanceTimersByTime(1000);
        expect(sent).toEqual([]);

        await input.trigger('pointerup', { pointerType: 'mouse' });
        await input.trigger('change');
        vi.advanceTimersByTime(349);
        expect(sent).toEqual([]);
        vi.advanceTimersByTime(1);

        expect(values()).toEqual(['{"target_temp":25}']);
    });

    it('bounds the slider by min, max and step', () => {
        const input = slider(mountClimate(wireDevice({ target_temp: { min: 7, max: 28, step: 0.5, unit: '°C' } })), t('climate.target'));

        expect(input.attributes()).toMatchObject({ min: '7', max: '28', step: '0.5' });
    });

    it('collapses a held arrow key into one command with the last value', async () => {
        const w = mountClimate();
        const input = slider(w, t('climate.target'));

        for (const v of [21.5, 22, 22.5, 23]) {
            await setTo(input, v);
            vi.advanceTimersByTime(100);
        }
        vi.advanceTimersByTime(400);

        expect(values()).toEqual(['{"target_temp":23}']);
    });

    it('follows the thumb in the readout while it is dragged, before anything is sent', async () => {
        const w = mountClimate();
        const input = slider(w, t('climate.target'));

        await input.trigger('pointerdown', { pointerType: 'mouse' });
        await dragTo(input, 26.5);

        expect(w.get('.climate-io__target').text()).toBe('26.5 °C');
        expect(sent).toEqual([]);
    });

    it('steps the target with + and -, merging quick taps into one command', async () => {
        const w = mountClimate();

        await w.get(`[aria-label="${t('climate.raise')}"]`).trigger('click');
        await w.get(`[aria-label="${t('climate.raise')}"]`).trigger('click');
        await w.get(`[aria-label="${t('climate.lower')}"]`).trigger('click');
        expect(w.get('.climate-io__target').text()).toBe('21.5 °C');

        vi.advanceTimersByTime(400);
        expect(values()).toEqual(['{"target_temp":21.5}']);
    });

    it('cannot step past the bounds, and disables the button at the edge', async () => {
        const w = mountClimate(wireDevice({}, { target_temp: 30 }));
        const raise = w.get(`[aria-label="${t('climate.raise')}"]`);

        expect((raise.element as HTMLButtonElement).disabled).toBe(true);
        await raise.trigger('click');
        vi.advanceTimersByTime(400);
        expect(sent).toEqual([]);
    });

    it('keeps the chosen value on screen until the server answers, then shows the server value', async () => {
        const w = mountClimate();

        await setTo(slider(w, t('climate.target')), 25);
        await vi.advanceTimersByTimeAsync(400);
        expect(w.get('.climate-io__target').text()).toBe('25.0 °C');
        expect(w.find('.io-row__pending').exists()).toBe(true);

        // The server clamps differently from what was asked.
        changed(wireDevice({}, { target_temp: 24.5 }));
        await w.vm.$nextTick();
        expect(w.get('.climate-io__target').text()).toBe('24.5 °C');
    });

    it('drops the chosen value if the answer never comes (pending timeout)', async () => {
        const w = mountClimate();

        await setTo(slider(w, t('climate.target')), 25);
        await vi.advanceTimersByTimeAsync(400);
        await vi.advanceTimersByTimeAsync(5000);

        expect(w.get('.climate-io__target').text()).toBe('21.0 °C');
    });

    it('drops the chosen value when the socket is closed and nothing was sent', async () => {
        const w = mountClimate();
        useHomeStore().attachTransport(() => false);

        await setTo(slider(w, t('climate.target')), 25);
        vi.advanceTimersByTime(400);
        await w.vm.$nextTick();

        expect(w.get('.climate-io__target').text()).toBe('21.0 °C');
    });

    it('shows a dash for a setpoint never received, and starts stepping from the bound', async () => {
        const w = mountClimate({ ...wireDevice(), state: without(FULL_STATE, 'target_temp') });
        expect(w.get('.climate-io__target').text()).toBe('— °C');

        await w.get(`[aria-label="${t('climate.raise')}"]`).trigger('click');
        vi.advanceTimersByTime(400);
        expect(values()).toEqual(['{"target_temp":16.5}']);
    });

    it('sends what is queued when the row goes away', () => {
        const w = mountClimate();
        w.get(`[aria-label="${t('climate.raise')}"]`).trigger('click');

        w.unmount();

        expect(values()).toEqual(['{"target_temp":21.5}']);
    });
});

describe('ClimateIo — range commands', () => {
    const lowLabel = t('climate.targetLow');
    const highLabel = t('climate.targetHigh');

    it('sends both bounds as one JSON object', async () => {
        const w = mountClimate(wireDevice({}, { mode: 'auto' }));

        await setTo(slider(w, lowLabel), 18);
        vi.advanceTimersByTime(400);

        expect(values()).toEqual(['{"target_temp_low":18,"target_temp_high":24}']);
    });

    it('merges moving both handles in a row into a single command', async () => {
        const w = mountClimate(wireDevice({}, { mode: 'auto' }));

        await setTo(slider(w, lowLabel), 18);
        await setTo(slider(w, highLabel), 27);
        vi.advanceTimersByTime(400);

        expect(values()).toEqual(['{"target_temp_low":18,"target_temp_high":27}']);
    });

    it('stops the low handle min_range below the high one', async () => {
        const w = mountClimate(wireDevice({}, { mode: 'auto' }));
        const low = slider(w, lowLabel);

        await setTo(low, 23.5);
        vi.advanceTimersByTime(400);

        expect((low.element as HTMLInputElement).value).toBe('22');
        expect(values()).toEqual(['{"target_temp_low":22,"target_temp_high":24}']);
    });

    it('stops the high handle min_range above the low one', async () => {
        const w = mountClimate(wireDevice({}, { mode: 'auto' }));
        const high = slider(w, highLabel);

        await setTo(high, 19);
        vi.advanceTimersByTime(400);

        expect((high.element as HTMLInputElement).value).toBe('21');
        expect(values()).toEqual(['{"target_temp_low":19,"target_temp_high":21}']);
    });

    it('never sends a pair tighter than min_range, whatever the drag did', async () => {
        const w = mountClimate(wireDevice({}, { mode: 'auto' }));

        for (const v of [20, 22.5, 23.9, 30]) await setTo(slider(w, lowLabel), v);
        for (const v of [20, 19]) await setTo(slider(w, highLabel), v);
        vi.advanceTimersByTime(400);

        const sentPair = JSON.parse(values()[0]) as { target_temp_low: number; target_temp_high: number };
        expect(sentPair.target_temp_high - sentPair.target_temp_low).toBeGreaterThanOrEqual(2);
    });

    it('lets the handles meet when the device publishes no min_range', async () => {
        const w = mountClimate(
            wireDevice({ target_temp: { min: 16, max: 30, step: 0.5, unit: '°C' } }, { mode: 'auto' }),
        );

        await setTo(slider(w, lowLabel), 24);
        vi.advanceTimersByTime(400);

        expect(values()).toEqual(['{"target_temp_low":24,"target_temp_high":24}']);
    });

    it('exposes the unit in the handles value text', () => {
        const w = mountClimate(wireDevice({}, { mode: 'auto' }));

        expect(slider(w, lowLabel).attributes('aria-valuetext')).toBe('19 °C');
        expect(slider(w, highLabel).attributes('aria-valuetext')).toBe('24 °C');
    });
});

describe('ClimateIo — fan and swing commands', () => {
    it('sends the chosen fan mode as a JSON partial update', async () => {
        const w = mountClimate();

        await w.get('select').setValue('high');
        vi.advanceTimersByTime(400);

        expect(values()).toEqual(['{"fan_mode":"high"}']);
        expect((w.get('select').element as HTMLSelectElement).value).toBe('high');
    });

    it('sends swing the same way', async () => {
        const w = mountClimate();

        await w.findAll('select')[1].setValue('vertical');
        vi.advanceTimersByTime(400);

        expect(values()).toEqual(['{"swing_mode":"vertical"}']);
    });

    it('merges fan, swing and a setpoint chosen together into one command', async () => {
        const w = mountClimate();

        await w.get('select').setValue('low');
        await w.findAll('select')[1].setValue('vertical');
        await setTo(slider(w, t('climate.target')), 22);
        vi.advanceTimersByTime(400);

        expect(values()).toEqual([
            '{"fan_mode":"low","swing_mode":"vertical","target_temp":22}',
        ]);
    });

    it('labels both selects, visibly and for assistive tech', () => {
        const w = mountClimate();

        for (const select of w.findAll('select')) {
            const label = w.get(`label[for="${select.attributes('id')}"]`);
            expect(label.text()).not.toBe('');
            expect(select.attributes('aria-label')).toContain(label.text());
        }
    });
});

describe('ClimateIo — accessibility', () => {
    it('gives every button and every slider an accessible name', () => {
        for (const mode of ['heat', 'auto', 'off']) {
            const w = mountClimate(wireDevice({}, { mode }));
            for (const el of [...w.findAll('button'), ...w.findAll('input[type="range"]')]) {
                const name = el.attributes('aria-label') ?? el.text();
                expect(name.trim(), `${mode}: ${el.html()}`).not.toBe('');
            }
        }
    });

    it('gives the single slider a value text with the unit', () => {
        const w = mountClimate();

        expect(slider(w, t('climate.target')).attributes('aria-valuetext')).toBe('21.0 °C');
    });
});
