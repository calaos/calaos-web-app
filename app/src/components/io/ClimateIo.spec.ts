import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import ClimateIo from './ClimateIo.vue';
import en from '../../i18n/en.json';
import fr from '../../i18n/fr.json';
import { closeClimate, openClimate, openClimateId } from '../../composables/useClimatePanel';
import { toHomeData } from '../../protocol/guards';
import { useHomeStore } from '../../stores/home';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en, fr } });
const NAME = 'Clim salon';

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

/** A key set to `undefined` is removed, so a capability or a field can be absent. */
function without(obj: Wire, ...keys: string[]): Wire {
    const copy = { ...obj };
    for (const key of keys) delete copy[key];
    return copy;
}

let sent: string[];
let wide: boolean;
let mounted: VueWrapper[];

/** The `value` of every set_state the component put on the wire. */
const values = (): string[] => sent.map((frame) => JSON.parse(frame).data.value as string);

const t = (key: string, params: Record<string, unknown> = { name: NAME }): string => i18n.global.t(key, params);

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
    const w = mount(ClimateIo, { props: { io }, global: { plugins: [i18n] }, attachTo: document.body });
    mounted.push(w);
    return w;
}

const body = () => new DOMWrapper(document.body);

/** Taps the row: the settings open in a panel (wide) or a dialog (narrow). */
async function openSettings(w: VueWrapper) {
    await w.get('.io-row').trigger('click');
    await w.vm.$nextTick();
}

const button = (label: string) => body().get(`button[aria-label="${label}"]`);
const isDisabled = (el: Omit<DOMWrapper<Element>, 'exists'>) => (el.element as HTMLButtonElement).disabled;
const nums = () => body().findAll('.climate-detail__num').map((n) => n.text());
const word = () => body().get('.climate-detail__word');
const pill = () => body().get('.climate-detail__pill');
const choices = () => body().findAll('[role="radio"]');
const choice = (label: string) => choices().find((c) => c.text() === label)!;

const raise = () => button(t('climate.raise'));
const lower = () => button(t('climate.lower'));

/** Answers the last set_state the way the server does for a command it refused. */
const refuseLast = (success = false) => {
    const { msg_id: msgId } = JSON.parse(sent.at(-1)!);
    useHomeStore().applySetStateResult({ kind: 'set_state', msgId, success });
};

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
    mounted = [];
    wide = true;
    window.matchMedia = ((query: string) => ({
        matches: query.includes('min-width: 64rem') ? wide : false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    useHomeStore().attachTransport((frame) => {
        sent.push(frame);
        return true;
    });
});

afterEach(() => {
    for (const w of mounted) w.unmount();
    document.body.innerHTML = '';
    closeClimate();
    i18n.global.locale.value = 'en';
    vi.useRealTimers();
});

// ---------------------------------------------------------------------------

describe('ClimateIo — the row', () => {
    it('reads the setpoint, the room temperature and the status, and shows no button of its own', () => {
        const w = mountClimate();

        expect(w.get('.io-row__name').text()).toBe(NAME);
        expect(w.get('.climate-io__set').text()).toBe('21°');
        expect(w.get('.io-row__value').text()).toContain('Room 23.4°');
        expect(w.get('.climate-io__status').text()).toBe('Heating');
        expect(w.findAll('.io-row__actions button')).toHaveLength(0);
        expect(w.get('.io-row').attributes('role')).toBe('button');
    });

    it('draws the mini dial with the setpoint and the room mark', () => {
        const w = mountClimate();

        const dial = w.get('.climate-dial--mini');
        expect(dial.findAll('.climate-dial__knob')).toHaveLength(1);
        // The room's temperature is a dot in the glyph, a tick in the panel.
        expect(dial.find('circle.climate-dial__mark').exists()).toBe(true);
        expect(dial.get('.climate-dial__fill').attributes('style')).toContain('var(--c-heat)');
    });

    it('shows the range of an auto device with its two knobs', () => {
        const w = mountClimate(wireDevice({}, { mode: 'auto', target_temp_low: 19.5, target_temp_high: 24.5 }));

        expect(w.get('.climate-io__set').text()).toBe('19.5 – 24.5°');
        expect(w.findAll('.climate-dial__knob')).toHaveLength(2);
    });

    it('shows -- for a setpoint never received, and drops the room when it is unknown', () => {
        const w = mountClimate({
            ...wireDevice(),
            state: without(FULL_STATE, 'target_temp', 'current_temp'),
        });

        expect(w.get('.climate-io__set').text()).toBe('--');
        expect(w.get('.io-row__value').text()).not.toContain('Room');
        expect(w.findAll('.climate-dial__knob')).toHaveLength(0);
        expect(w.find('.climate-dial__mark').exists()).toBe(false);
    });

    it('shows no setpoint in fan_only, nor without a target_temp capability, like the settings', () => {
        const fan = mountClimate(wireDevice({}, { mode: 'fan_only', action: 'fan' }));
        expect(fan.find('.climate-io__set').exists()).toBe(false);
        expect(fan.get('.io-row__value').text()).toBe('Room 23.4°');
        expect(fan.find('.climate-io__dot').exists()).toBe(false);

        const bare = mountClimate({ ...wireDevice(), capabilities: { modes: ['off', 'heat'] } });
        expect(bare.find('.climate-io__set').exists()).toBe(false);
    });

    it('formats numbers and words for the locale', () => {
        i18n.global.locale.value = 'fr';
        const w = mountClimate(wireDevice({}, { target_temp: 21.5, current_temp: 25.4, action: 'cooling' }));

        expect(w.get('.climate-io__set').text()).toBe('21,5°');
        expect(w.get('.io-row__value').text()).toContain('Pièce 25,4°');
        expect(w.get('.climate-io__status').text()).toBe('Refroidit');
    });

    it('is a plain name and scalar state, not a button, without a usable device', () => {
        const w = mountClimate(null);

        expect(w.get('.io-row__value').text()).toBe('heat');
        expect(w.get('.io-row').attributes('role')).toBeUndefined();
        expect(w.find('.climate-dial').exists()).toBe(false);
        expect(w.find('.climate-io__status').exists()).toBe(false);
    });

    it('ignores a device of another family', () => {
        const w = mountClimate({ ...wireDevice(), family: 'fan' });

        expect(w.get('.io-row').attributes('role')).toBeUndefined();
        expect(w.get('.io-row__value').text()).toBe('heat');
    });

    it('marks itself pending while a command is out', async () => {
        const w = mountClimate();
        await openSettings(w);
        await raise().trigger('click');
        await vi.advanceTimersByTimeAsync(400);

        expect(w.find('.io-row__pending').exists()).toBe(true);
    });
});

// Status text and colour, in the row and in the settings. `long` is what the
// settings say, `short` what a row has room for.
const STATUSES: {
    name: string;
    state: Wire;
    caps?: Wire;
    short: string;
    long: string;
    tone: string;
}[] = [
    { name: 'heating', state: { action: 'heating' }, short: 'Heating', long: 'Heating', tone: '--c-heat' },
    { name: 'cooling', state: { mode: 'cool', action: 'cooling' }, short: 'Cooling', long: 'Cooling', tone: '--c-accent' },
    { name: 'drying', state: { mode: 'dry', action: 'drying' }, short: 'Drying', long: 'Drying', tone: '--c-accent' },
    { name: 'fan', state: { mode: 'fan_only', action: 'fan' }, short: 'Fan running', long: 'Fan running', tone: '--c-text' },
    { name: 'idle', state: { action: 'idle' }, short: 'Idle', long: 'Idle', tone: '--c-text-muted' },
    {
        name: 'lockout',
        state: { action: 'idle', lockout: { output: 'heat', remaining: 140 } },
        short: 'Waiting',
        long: 'Starts in 2 min 20',
        tone: '--c-warn',
    },
    { name: 'offline', state: { connected: false }, short: 'Offline', long: 'Offline', tone: '--c-danger' },
    { name: 'fault', state: { fault: 'sensor_stale' }, short: 'Sensor silent', long: 'Sensor silent', tone: '--c-danger' },
    { name: 'off', state: { mode: 'off', action: 'off' }, short: 'Stopped', long: 'Stopped', tone: '--c-text-muted' },
    { name: 'unknown mode', state: { mode: '' }, short: 'Unknown', long: 'Mode unknown', tone: '--c-text-muted' },
    { name: 'unknown mode (absent)', state: { mode: undefined }, short: 'Unknown', long: 'Mode unknown', tone: '--c-text-muted' },
    {
        name: 'a device that reports no action',
        state: { mode: 'cool', action: undefined },
        caps: { reports_action: undefined },
        short: 'Cool',
        long: 'Cool',
        tone: '--c-text-muted',
    },
];

describe('ClimateIo — every status', () => {
    for (const s of STATUSES) {
        it(`${s.name}: the row says "${s.short}" in ${s.tone}`, () => {
            const w = mountClimate(wireDevice(s.caps ?? {}, s.state));
            const status = w.get('.climate-io__status');

            expect(status.text()).toBe(s.short);
            expect(status.attributes('style')).toContain(`var(${s.tone})`);
        });

        it(`${s.name}: the settings say "${s.long}" in ${s.tone}`, async () => {
            const w = mountClimate(wireDevice(s.caps ?? {}, s.state));
            await openSettings(w);

            expect(word().text()).toBe(s.long);
            expect(word().attributes('style')).toContain(`var(${s.tone})`);
        });
    }

    it('names the faults the server can raise, and any other one generically', () => {
        const say = (fault: string) =>
            mountClimate(wireDevice({}, { fault })).get('.climate-io__status').text();

        expect(say('sensor_stale')).toBe('Sensor silent');
        expect(say('sensor_missing')).toBe('Sensor missing');
        expect(say('humidity_high')).toBe('Humidity too high');
        expect(say('humidity_stale')).toBe('Humidity sensor silent');
        expect(say('something_new')).toBe('Fault');
    });

    it('says an unreachable device is offline before anything else', () => {
        const w = mountClimate(
            wireDevice({}, { connected: false, fault: 'sensor_stale', lockout: { output: 'heat', remaining: 9 }, mode: 'off' }),
        );

        expect(w.get('.climate-io__status').text()).toBe('Offline');
    });

    it('says a fault before the mode and the lock-out', () => {
        const w = mountClimate(wireDevice({}, { fault: 'sensor_stale', mode: '', lockout: { output: 'heat', remaining: 9 } }));

        expect(w.get('.climate-io__status').text()).toBe('Sensor silent');
    });

    it('says the mode is off or unknown before the lock-out and the action', () => {
        const off = mountClimate(wireDevice({}, { mode: 'off', lockout: { output: 'heat', remaining: 9 } }));
        expect(off.get('.climate-io__status').text()).toBe('Stopped');
    });

    it('says the lock-out before the action it explains', () => {
        const w = mountClimate(wireDevice({}, { action: 'heating', lockout: { output: 'heat', remaining: 9 } }));

        expect(w.get('.climate-io__status').text()).toBe('Waiting');
    });

    it('colours the mini dial by what the device does', () => {
        const fill = (state: Wire) =>
            mountClimate(wireDevice({}, state)).get('.climate-dial__fill').attributes('style');

        expect(fill({ action: 'heating' })).toContain('var(--c-heat)');
        expect(fill({ mode: 'cool', action: 'cooling' })).toContain('var(--c-accent)');
        expect(fill({ action: 'idle', lockout: { output: 'heat', remaining: 9 } })).toContain('var(--c-warn)');
        // Nothing running: neutral. Unreachable: dimmed.
        expect(fill({ action: 'idle' })).toContain('var(--c-text-muted)');
        expect(fill({ mode: 'off' })).toContain('var(--c-text-muted)');
        expect(fill({ connected: false })).toContain('var(--c-border-strong)');
        expect(fill({ fault: 'sensor_stale' })).toContain('var(--c-border-strong)');
    });

    it('greys the knobs of an auto device that is offline or in fault', () => {
        for (const state of [{ connected: false }, { fault: 'sensor_stale' }]) {
            const w = mountClimate(wireDevice({}, { mode: 'auto', ...state }));
            const knobs = w.findAll('.climate-dial__knob').map((k) => k.attributes('style'));

            expect(knobs).toHaveLength(2);
            for (const style of knobs) expect(style).toContain('var(--c-text-muted)');
            w.unmount();
            mounted = [];
        }
    });
});

describe('ClimateIo — opening the settings', () => {
    it('opens a side panel beside the list on a wide screen', async () => {
        const w = mountClimate();
        await openSettings(w);

        const panel = document.querySelector('.climate-panel');
        expect(panel).not.toBeNull();
        expect(panel?.getAttribute('aria-label')).toBe('Clim salon settings');
        expect(panel?.querySelector('h2')?.textContent).toBe(NAME);
        expect(panel?.querySelector('.climate-panel__eyebrow')?.textContent).toBe('Salon');
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(w.get('.io-row').attributes('aria-expanded')).toBe('true');
    });

    it('opens a wide centred dialog below 1024 px, with the same content', async () => {
        wide = false;
        const w = mountClimate();
        await openSettings(w);

        expect(document.querySelector('.climate-panel')).toBeNull();
        const dialog = document.querySelector('[role="dialog"]');
        expect(dialog?.classList.contains('base-dialog__panel--wide')).toBe(true);
        expect(dialog?.querySelector('h2')?.textContent).toBe(NAME);
        expect(dialog?.querySelector('.climate-detail')).not.toBeNull();
        // Nothing to confirm: the cross is the way out.
        expect(dialog?.querySelector('.base-dialog__actions')).toBeNull();
    });

    it('closes with the cross and with Escape, in both layouts', async () => {
        for (const isWide of [true, false]) {
            wide = isWide;
            const w = mountClimate();
            await openSettings(w);
            await button(t('climate.close')).trigger('click');
            expect(openClimateId.value).toBeNull();
            expect(body().find('.climate-detail').exists()).toBe(false);

            await openSettings(w);
            const escapeTarget = isWide ? '.climate-panel' : '.base-dialog';
            await body().get(escapeTarget).trigger('keydown', { key: 'Escape' });
            expect(openClimateId.value).toBeNull();
            w.unmount();
            mounted = [];
        }
    });

    it('closes when another device takes the panel, and when the row goes away', async () => {
        const w = mountClimate();
        await openSettings(w);
        expect(body().find('.climate-detail').exists()).toBe(true);

        openClimate('another');
        await w.vm.$nextTick();
        expect(body().find('.climate-detail').exists()).toBe(false);

        openClimate('clim');
        await w.vm.$nextTick();
        w.unmount();
        mounted = [];
        expect(openClimateId.value).toBeNull();
    });

    it('closes when the device stops being a usable device', async () => {
        const w = mountClimate();
        await openSettings(w);

        const home = useHomeStore();
        home.handleEvent({ kind: 'io_changed', id: 'clim', state: 'heat' });
        // A device that vanished from an update is replaced, not merged.
        const io = home.ios.get('clim')!;
        delete (io as { device?: unknown }).device;
        await w.vm.$nextTick();

        expect(openClimateId.value).toBeNull();
    });

    it('opens from the keyboard', async () => {
        const w = mountClimate();
        await w.get('.io-row').trigger('keydown', { key: 'Enter' });
        await w.vm.$nextTick();

        expect(body().find('.climate-detail').exists()).toBe(true);
    });
});

describe('ClimateIo — the dial and the setpoint line', () => {
    it('puts the room, the status and the setpoint in the settings', async () => {
        const w = mountClimate(wireDevice({}, { mode: 'cool', action: 'cooling' }));
        await openSettings(w);

        expect(body().get('.climate-detail__room').text()).toBe('Room 23.4°');
        expect(word().text()).toBe('Cooling');
        expect(nums()).toEqual(['21°']);
        expect(body().findAll('.climate-panel .climate-dial__knob')).toHaveLength(1);
        // The room's temperature is a tick across the track.
        expect(body().find('line.climate-dial__mark').exists()).toBe(true);
    });

    it('steps by the capability step and enables both buttons inside the bounds', async () => {
        const w = mountClimate();
        await openSettings(w);

        expect(isDisabled(raise())).toBe(false);
        expect(isDisabled(lower())).toBe(false);
    });

    it('disables the button that would leave the bounds', async () => {
        const w = mountClimate(wireDevice({}, { target_temp: 30 }));
        await openSettings(w);
        expect(isDisabled(raise())).toBe(true);
        expect(isDisabled(lower())).toBe(false);

        await raise().trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        expect(sent).toEqual([]);
    });

    it('refuses -/+ when the device is offline or its mode is unknown, but not when it is off', async () => {
        for (const state of [{ connected: false }, { mode: '' }]) {
            const w = mountClimate(wireDevice({}, state));
            await openSettings(w);
            expect(isDisabled(raise())).toBe(true);
            expect(isDisabled(lower())).toBe(true);
            await button(t('climate.close')).trigger('click');
            w.unmount();
            mounted = [];
        }

        const off = mountClimate(wireDevice({}, { mode: 'off', action: 'off' }));
        await openSettings(off);
        expect(isDisabled(raise())).toBe(false);
        expect(nums()).toEqual(['21°']);
    });

    it('shows -- for a setpoint never received and steps from the bound', async () => {
        const w = mountClimate({ ...wireDevice(), state: without(FULL_STATE, 'target_temp') });
        await openSettings(w);
        expect(nums()).toEqual(['--']);

        await raise().trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        expect(values()).toEqual(['{"target_temp":16.5}']);
    });

    it('has no setpoint line without a target_temp capability', async () => {
        const w = mountClimate({ ...wireDevice(), capabilities: { modes: ['off', 'heat'] } });
        await openSettings(w);

        expect(body().find('.climate-detail__line').exists()).toBe(false);
        expect(body().find('.climate-dial__knob').exists()).toBe(false);
    });

    it('has no setpoint line in fan_only', async () => {
        const w = mountClimate(wireDevice({}, { mode: 'fan_only', action: 'fan' }));
        await openSettings(w);

        expect(body().find('.climate-detail__line').exists()).toBe(false);
    });

    it('shows a dimmed number when the device is offline', async () => {
        const w = mountClimate(wireDevice({}, { connected: false }));
        await openSettings(w);

        expect(body().get('.climate-detail__num').classes()).toContain('climate-detail__num--dim');
        expect(pill().attributes('disabled')).toBeDefined();
    });
});

describe('ClimateIo — the range in auto', () => {
    const auto = (state: Wire = {}, caps: Wire = {}) =>
        wireDevice(caps, { mode: 'auto', target_temp_low: 19.5, target_temp_high: 24.5, action: 'heating', ...state });

    it('shows two readouts, warm below and cool above, with their own buttons', async () => {
        const w = mountClimate(auto());
        await openSettings(w);

        expect(nums()).toEqual(['19.5°', '24.5°']);
        const [low, high] = body().findAll('.climate-detail__num');
        expect(low.classes()).toContain('climate-detail__num--heat');
        expect(high.classes()).toContain('climate-detail__num--cool');
        expect(body().findAll('.climate-detail__group button')).toHaveLength(4);
        expect(body().findAll('.climate-panel .climate-dial__knob')).toHaveLength(2);
        expect(body().find('.climate-detail__stop').exists()).toBe(false);
    });

    it('colours the arc between the knobs by the action, grey when nothing runs', async () => {
        const running = mountClimate(auto());
        await openSettings(running);
        expect(body().get('.climate-dial__fill').attributes('style')).toContain('var(--c-heat)');
        await button(t('climate.close')).trigger('click');
        running.unmount();
        mounted = [];

        const idle = mountClimate(auto({ action: 'idle' }));
        await openSettings(idle);
        expect(body().get('.climate-dial__fill').attributes('style')).toContain('var(--c-border-strong)');
    });

    it('sends both ends as one command when one is nudged', async () => {
        const w = mountClimate(auto());
        await openSettings(w);

        await button(t('climate.raiseLow')).trigger('click');
        await vi.advanceTimersByTimeAsync(400);

        expect(values()).toEqual(['{"target_temp_low":20,"target_temp_high":24.5}']);
        expect(nums()).toEqual(['20°', '24.5°']);
    });

    it('merges taps on both ends into one command', async () => {
        const w = mountClimate(auto());
        await openSettings(w);

        await button(t('climate.raiseLow')).trigger('click');
        await button(t('climate.lowerHigh')).trigger('click');
        await vi.advanceTimersByTimeAsync(400);

        expect(values()).toEqual(['{"target_temp_low":20,"target_temp_high":24}']);
    });

    it('refuses the inner buttons at the min_range stop and says why', async () => {
        const w = mountClimate(auto({ target_temp_low: 21, target_temp_high: 23, action: 'idle' }));
        await openSettings(w);

        expect(body().get('.climate-detail__stop').text()).toBe('Minimum gap 2°');
        expect(isDisabled(button(t('climate.raiseLow')))).toBe(true);
        expect(isDisabled(button(t('climate.lowerHigh')))).toBe(true);
        expect(isDisabled(button(t('climate.lowerLow')))).toBe(false);
        expect(isDisabled(button(t('climate.raiseHigh')))).toBe(false);

        await button(t('climate.raiseLow')).trigger('click');
        await button(t('climate.lowerHigh')).trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        expect(sent).toEqual([]);
    });

    it('frees the inner buttons as soon as an outer one has moved away', async () => {
        const w = mountClimate(auto({ target_temp_low: 21, target_temp_high: 23 }));
        await openSettings(w);

        await button(t('climate.lowerLow')).trigger('click');

        expect(isDisabled(button(t('climate.raiseLow')))).toBe(false);
        expect(body().find('.climate-detail__stop').exists()).toBe(false);
    });

    it('never sends a pair tighter than min_range', async () => {
        const w = mountClimate(auto({ target_temp_low: 21.5, target_temp_high: 23.5 }));
        await openSettings(w);

        for (let i = 0; i < 4; i++) await button(t('climate.raiseLow')).trigger('click');
        await vi.advanceTimersByTimeAsync(400);

        expect(sent).toEqual([]);
    });

    it('clamps a step that would leave the ends closer than min_range, instead of sending it', async () => {
        // Step 1 and a 2.5 gap: one step up from 19 would leave 20 – 22, too close.
        const w = mountClimate(
            auto(
                { target_temp_low: 19, target_temp_high: 22 },
                { target_temp: { min: 16, max: 30, step: 1, unit: '°C', min_range: 2.5 } },
            ),
        );
        await openSettings(w);
        expect(isDisabled(button(t('climate.raiseLow')))).toBe(false);

        await button(t('climate.raiseLow')).trigger('click');
        await vi.advanceTimersByTimeAsync(400);

        expect(sent).toEqual([]);
        expect(nums()).toEqual(['19°', '22°']);
    });

    it('has no stop when the device publishes no min_range, and the ends may meet', async () => {
        const w = mountClimate(
            auto({ target_temp_low: 22.5, target_temp_high: 23 }, { target_temp: { min: 16, max: 30, step: 0.5, unit: '°C' } }),
        );
        await openSettings(w);

        expect(body().find('.climate-detail__stop').exists()).toBe(false);
        await button(t('climate.raiseLow')).trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        expect(values()).toEqual(['{"target_temp_low":23,"target_temp_high":23}']);
    });

    it('keeps a single setpoint outside auto, even on a device with a range', async () => {
        const w = mountClimate(wireDevice({}, { mode: 'cool' }));
        await openSettings(w);

        expect(nums()).toEqual(['21°']);
    });

    it('keeps a single setpoint in auto on a device that has no range', async () => {
        const w = mountClimate(wireDevice({ target_temp_range: undefined }, { mode: 'auto' }));
        await openSettings(w);

        expect(nums()).toEqual(['21°']);
    });

    it('shows the range of a range-only device in every mode but fan_only', async () => {
        const rangeOnly = { mode: 'm', target_temp_low: 'l', target_temp_high: 'h' };
        const w = mountClimate(wireDevice({}, { mode: 'heat' }, rangeOnly));
        await openSettings(w);
        expect(nums()).toEqual(['19°', '24°']);
        await button(t('climate.close')).trigger('click');
        w.unmount();
        mounted = [];

        const fan = mountClimate(wireDevice({}, { mode: 'fan_only', action: 'fan' }, rangeOnly));
        await openSettings(fan);
        expect(nums()).toEqual([]);
    });

    it('shows a half-known range but does not let it be edited', async () => {
        const w = mountClimate({ ...auto(), state: without(auto().state, 'target_temp_high') });
        await openSettings(w);

        expect(nums()).toEqual(['19.5°', '--']);
        for (const label of ['raiseLow', 'lowerLow', 'raiseHigh', 'lowerHigh']) {
            expect(isDisabled(button(t(`climate.${label}`)))).toBe(true);
        }
    });

    it('moves a range the server moved under it from the new values', async () => {
        const w = mountClimate(auto());
        await openSettings(w);

        changed(auto({ target_temp_low: 25, target_temp_high: 28 }));
        await w.vm.$nextTick();
        expect(nums()).toEqual(['25°', '28°']);

        await button(t('climate.raiseHigh')).trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        expect(values()).toEqual(['{"target_temp_low":25,"target_temp_high":28.5}']);
    });
});

describe('ClimateIo — what the capabilities hide', () => {
    it('offers More settings only when fan, swing or humidity exist', async () => {
        const has = async (caps: Wire, state: Wire = {}) => {
            const w = mountClimate(wireDevice(caps, state));
            await openSettings(w);
            const found = body().find('.climate-detail__more').exists();
            await button(t('climate.close')).trigger('click');
            w.unmount();
            mounted = [];
            return found;
        };
        const none = { fan_modes: undefined, swing_modes: undefined };

        expect(await has({})).toBe(true);
        expect(await has({ ...none, swing_modes: ['off', 'vertical'] })).toBe(true);
        expect(await has({ ...none, fan_modes: ['auto'] })).toBe(true);
        expect(await has(none)).toBe(false);
        expect(await has({ ...none, fan_modes: [], swing_modes: [] })).toBe(false);
        expect(await has(none, { humidity: 51 })).toBe(true);
    });

    it('lists ventilation and oscillation only when the device announces them', async () => {
        const w = mountClimate(wireDevice({ swing_modes: undefined }));
        await openSettings(w);
        await body().get('.climate-detail__more').trigger('click');

        const titles = body().findAll('.climate-more__title').map((h) => h.text());
        expect(titles).toEqual(['Fan']);
        expect(choices().map((c) => c.text())).toEqual(['Auto', 'Low', 'High']);
        expect(body().find('.climate-more__humidity').exists()).toBe(false);
        w.unmount();
        mounted = [];

        const swingOnly = mountClimate(wireDevice({ fan_modes: undefined }));
        await openSettings(swingOnly);
        await body().get('.climate-detail__more').trigger('click');
        expect(body().findAll('.climate-more__title').map((h) => h.text())).toEqual(['Swing']);
        expect(choices().map((c) => c.text())).toEqual(['Fixed', 'Vertical']);
    });

    it('shows the humidity reading when the server publishes one, and only then', async () => {
        const w = mountClimate(wireDevice({}, { humidity: 48 }));
        await openSettings(w);
        await body().get('.climate-detail__more').trigger('click');

        expect(body().get('.climate-more__humidity').text()).toBe('Humidity 48 %');
    });

    it('formats the humidity for the language', async () => {
        i18n.global.locale.value = 'fr';
        const w = mountClimate(wireDevice({}, { humidity: 48.5 }));
        await openSettings(w);
        await body().get('.climate-detail__more').trigger('click');

        expect(body().get('.climate-more__humidity').text()).toBe('Humidité 48,5 %');
    });

    it('marks the current fan and swing, keeps a value it has no word for, and translates', async () => {
        const w = mountClimate(wireDevice({}, { fan_mode: 'turbo' }));
        await openSettings(w);
        await body().get('.climate-detail__more').trigger('click');

        expect(choices().map((c) => c.text())).toEqual(['Auto', 'Low', 'High', 'turbo', 'Fixed', 'Vertical']);
        expect(choices().filter((c) => c.attributes('aria-checked') === 'true').map((c) => c.text())).toEqual([
            'turbo',
            'Fixed',
        ]);
    });

    it('lists exactly the modes of capabilities.modes, and no others', async () => {
        const w = mountClimate(wireDevice({ modes: ['off', 'heat', 'cool'] }));
        await openSettings(w);
        await pill().trigger('click');

        expect(choices().map((c) => c.text())).toEqual(['Off', 'Heat', 'Cool']);
    });

    it('translates the mode names', async () => {
        i18n.global.locale.value = 'fr';
        const w = mountClimate(wireDevice({ modes: ['off', 'dry', 'fan_only'] }));
        await openSettings(w);
        await pill().trigger('click');

        expect(choices().map((c) => c.text())).toEqual(['Arrêt', 'Déshumidification', 'Ventilation']);
    });
});

describe('ClimateIo — the mode', () => {
    it('shows the mode on the pill with its glyph, and ticks it in the list', async () => {
        const w = mountClimate(wireDevice({}, { mode: 'cool' }));
        await openSettings(w);

        expect(pill().text()).toBe('Cool');
        await pill().trigger('click');
        expect(choices().filter((c) => c.attributes('aria-checked') === 'true').map((c) => c.text())).toEqual(['Cool']);
    });

    it('sends a plain mode, not JSON, closes the list, and marks the row pending', async () => {
        const w = mountClimate();
        await openSettings(w);
        await pill().trigger('click');

        await choice('Cool').trigger('click');

        expect(values()).toEqual(['cool']);
        expect(w.find('.io-row__pending').exists()).toBe(true);
        expect(body().find('[role="radiogroup"]').exists()).toBe(false);
        // Not optimistic: the pill keeps the server's mode until it answers.
        expect(pill().text()).toBe('Heat');
        changed(wireDevice({}, { mode: 'cool' }));
        await w.vm.$nextTick();
        expect(pill().text()).toBe('Cool');
    });

    it('does not resend the mode it is already in', async () => {
        const w = mountClimate();
        await openSettings(w);
        await pill().trigger('click');
        await choice('Heat').trigger('click');

        expect(sent).toEqual([]);
    });

    it('sends a setpoint chosen just before a mode change first, so the mode cannot overtake it', async () => {
        const w = mountClimate();
        await openSettings(w);
        await raise().trigger('click');
        await pill().trigger('click');
        await choice('Cool').trigger('click');

        expect(values()).toEqual(['{"target_temp":21.5}', 'cool']);
    });

    it('sends the displayed mode again while another mode is still pending', async () => {
        const w = mountClimate();
        await openSettings(w);

        await pill().trigger('click');
        await choice('Cool').trigger('click');
        await pill().trigger('click');
        await choice('Heat').trigger('click');

        expect(values()).toEqual(['cool', 'heat']);
    });

    it('goes back to ignoring the displayed mode once the answer arrived', async () => {
        const w = mountClimate();
        await openSettings(w);
        await pill().trigger('click');
        await choice('Cool').trigger('click');
        changed(wireDevice({}, { mode: 'cool' }));
        await w.vm.$nextTick();

        await pill().trigger('click');
        await choice('Cool').trigger('click');

        expect(values()).toEqual(['cool']);
    });

    it('shows an unknown mode as such, ticks nothing, and still lets one be chosen', async () => {
        const w = mountClimate(wireDevice({}, { mode: '' }));
        await openSettings(w);

        expect(pill().text()).toBe('Mode unknown');
        expect(pill().attributes('disabled')).toBeUndefined();
        await pill().trigger('click');
        expect(choices().filter((c) => c.attributes('aria-checked') === 'true')).toHaveLength(0);

        await choice('Heat').trigger('click');
        expect(values()).toEqual(['heat']);
    });

    it('survives a device with nothing at all in it', async () => {
        const w = mountClimate({ family: 'climate' });
        await openSettings(w);

        expect(w.get('.climate-io__status').text()).toBe('Unknown');
        expect(pill().text()).toBe('Mode unknown');
        expect(body().find('.climate-detail__line').exists()).toBe(false);
        expect(body().find('.climate-detail__more').exists()).toBe(false);
    });
});

describe('ClimateIo — setpoint commands', () => {
    it('sends one JSON partial update per burst, after the quiet period', async () => {
        const w = mountClimate();
        await openSettings(w);

        await raise().trigger('click');
        expect(sent).toEqual([]);
        await vi.advanceTimersByTimeAsync(349);
        expect(sent).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);

        expect(values()).toEqual(['{"target_temp":21.5}']);
    });

    it('merges quick taps into one command carrying the last value', async () => {
        const w = mountClimate();
        await openSettings(w);

        await raise().trigger('click');
        await raise().trigger('click');
        await lower().trigger('click');
        expect(nums()).toEqual(['21.5°']);

        await vi.advanceTimersByTimeAsync(400);
        expect(values()).toEqual(['{"target_temp":21.5}']);
    });

    it('keeps the chosen value on screen until the server answers, then shows the server value', async () => {
        const w = mountClimate();
        await openSettings(w);
        await raise().trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        expect(nums()).toEqual(['21.5°']);
        expect(w.find('.io-row__pending').exists()).toBe(true);

        // The server rounds differently from what was asked.
        changed(wireDevice({}, { target_temp: 22 }));
        await w.vm.$nextTick();
        expect(nums()).toEqual(['22°']);
        expect(w.get('.climate-io__set').text()).toBe('22°');
    });

    it('drops the chosen value if the answer never comes (pending timeout)', async () => {
        const w = mountClimate();
        await openSettings(w);
        await raise().trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        await vi.advanceTimersByTimeAsync(5000);

        expect(nums()).toEqual(['21°']);
    });

    it('drops the chosen value when the socket is closed and nothing was sent', async () => {
        const w = mountClimate();
        useHomeStore().attachTransport(() => false);
        await openSettings(w);

        await raise().trigger('click');
        await vi.advanceTimersByTimeAsync(400);

        expect(nums()).toEqual(['21°']);
    });

    it('sends what is queued when the row goes away', async () => {
        const w = mountClimate();
        await openSettings(w);
        await raise().trigger('click');

        w.unmount();
        mounted = [];

        expect(values()).toEqual(['{"target_temp":21.5}']);
    });

    it('keeps the chosen value when only the current temperature changed', async () => {
        const w = mountClimate();
        await openSettings(w);
        await raise().trigger('click');
        await vi.advanceTimersByTimeAsync(400);

        changed(wireDevice({}, { current_temp: 23.9 }));
        await w.vm.$nextTick();
        expect(nums()).toEqual(['21.5°']);

        changed(wireDevice({}, { current_temp: 23.9, target_temp: 21.5 }));
        await w.vm.$nextTick();
        expect(nums()).toEqual(['21.5°']);
        await vi.advanceTimersByTimeAsync(6000);
    });

    it('lets a newer choice on the same field survive the answer to the older one', async () => {
        const w = mountClimate();
        await openSettings(w);
        await raise().trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        await raise().trigger('click');

        changed(wireDevice({}, { target_temp: 21.5 }));
        await w.vm.$nextTick();
        expect(nums()).toEqual(['22°']);
    });

    it('ends the draft of a range end when the server reports another value for it', async () => {
        const w = mountClimate(wireDevice({}, { mode: 'auto' }));
        await openSettings(w);
        await button(t('climate.raiseLow')).trigger('click');
        await vi.advanceTimersByTimeAsync(400);

        changed(wireDevice({}, { mode: 'auto', target_temp_low: 19, target_temp_high: 24, current_temp: 20 }));
        await w.vm.$nextTick();
        expect(nums()).toEqual(['19.5°', '24°']);
        changed(wireDevice({}, { mode: 'auto', target_temp_low: 20.5 }));
        await w.vm.$nextTick();
        expect(nums()).toEqual(['20.5°', '24°']);
    });
});

describe('ClimateIo — two commands in flight', () => {
    it('keeps the second setpoint on screen when only the first one was answered', async () => {
        const w = mountClimate();
        await openSettings(w);
        await raise().trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        await raise().trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        expect(values()).toEqual(['{"target_temp":21.5}', '{"target_temp":22}']);

        changed(wireDevice({}, { target_temp: 21.5 }));
        await w.vm.$nextTick();
        expect(nums()).toEqual(['22°']);

        changed(wireDevice({}, { target_temp: 22 }));
        await w.vm.$nextTick();
        expect(nums()).toEqual(['22°']);

        // Both answered: the draft is gone, another client's value shows.
        changed(wireDevice({}, { target_temp: 25 }));
        await w.vm.$nextTick();
        expect(nums()).toEqual(['25°']);
    });

    it('does the same for a range end', async () => {
        const w = mountClimate(wireDevice({}, { mode: 'auto' }));
        await openSettings(w);
        await button(t('climate.raiseLow')).trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        await button(t('climate.raiseLow')).trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        expect(values()).toEqual([
            '{"target_temp_low":19.5,"target_temp_high":24}',
            '{"target_temp_low":20,"target_temp_high":24}',
        ]);

        changed(wireDevice({}, { mode: 'auto', target_temp_low: 19.5 }));
        await w.vm.$nextTick();
        expect(nums()).toEqual(['20°', '24°']);

        changed(wireDevice({}, { mode: 'auto', target_temp_low: 20 }));
        await w.vm.$nextTick();
        changed(wireDevice({}, { mode: 'auto', target_temp_low: 18 }));
        await w.vm.$nextTick();
        expect(nums()).toEqual(['18°', '24°']);
    });
});

describe('ClimateIo — answers and outside changes while commands are in flight', () => {
    it('lets the server win over three setpoints in flight when it jumps straight to the last one', async () => {
        const w = mountClimate();
        await openSettings(w);
        for (let i = 0; i < 3; i++) {
            await raise().trigger('click');
            await vi.advanceTimersByTimeAsync(400);
        }
        expect(values()).toEqual(['{"target_temp":21.5}', '{"target_temp":22}', '{"target_temp":22.5}']);

        changed(wireDevice({}, { target_temp: 22.5 }));
        await w.vm.$nextTick();
        expect(nums()).toEqual(['22.5°']);

        // Someone else sets 25: it shows at once, and the next tap starts from it.
        changed(wireDevice({}, { target_temp: 25 }));
        await w.vm.$nextTick();
        expect(nums()).toEqual(['25°']);

        await raise().trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        expect(values().at(-1)).toBe('{"target_temp":25.5}');
    });

    it('shows an outside change of both range ends after each command was answered', async () => {
        const w = mountClimate(wireDevice({}, { mode: 'auto' }));
        await openSettings(w);
        await button(t('climate.raiseLow')).trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        await button(t('climate.raiseLow')).trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        await button(t('climate.raiseHigh')).trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        expect(values()).toEqual([
            '{"target_temp_low":19.5,"target_temp_high":24}',
            '{"target_temp_low":20,"target_temp_high":24}',
            '{"target_temp_low":20,"target_temp_high":24.5}',
        ]);

        // Every command comes back with both ends.
        for (const [low, high] of [[19.5, 24], [20, 24], [20, 24.5]]) {
            changed(wireDevice({}, { mode: 'auto', target_temp_low: low, target_temp_high: high }));
            await w.vm.$nextTick();
        }
        expect(nums()).toEqual(['20°', '24.5°']);

        changed(wireDevice({}, { mode: 'auto', target_temp_low: 18, target_temp_high: 26 }));
        await w.vm.$nextTick();
        expect(nums()).toEqual(['18°', '26°']);
    });

    it('lets the server win when it answers with a value nobody sent, even with a later command out', async () => {
        const w = mountClimate();
        await openSettings(w);
        await raise().trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        await raise().trigger('click');
        await vi.advanceTimersByTimeAsync(400);

        // Another client set 27 meanwhile.
        changed(wireDevice({}, { target_temp: 27 }));
        await w.vm.$nextTick();
        expect(nums()).toEqual(['27°']);
    });

    it('keeps a value the user took back on screen until the server has caught up with it', async () => {
        const w = mountClimate();
        await openSettings(w);
        await raise().trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        await lower().trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        expect(values()).toEqual(['{"target_temp":21.5}', '{"target_temp":21}']);

        // The 21.5 lands first; 21 is on its way.
        changed(wireDevice({}, { target_temp: 21.5 }));
        await w.vm.$nextTick();
        expect(nums()).toEqual(['21°']);

        // Then it does, and the draft is spent: an outside change shows.
        changed(wireDevice({}, { target_temp: 21 }));
        await w.vm.$nextTick();
        changed(wireDevice({}, { target_temp: 25 }));
        await w.vm.$nextTick();
        expect(nums()).toEqual(['25°']);
    });
});

describe('ClimateIo — the same value sent twice', () => {
    async function plusMinusPlus() {
        const w = mountClimate();
        await openSettings(w);
        await raise().trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        await lower().trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        await raise().trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        expect(values()).toEqual(['{"target_temp":21.5}', '{"target_temp":21}', '{"target_temp":21.5}']);
        return w;
    }

    it('keeps the draft while the third command, which sent the same value as the first, is still out', async () => {
        const w = await plusMinusPlus();

        changed(wireDevice({}, { target_temp: 21.5 }));
        await w.vm.$nextTick();
        changed(wireDevice({}, { target_temp: 21 }));
        await w.vm.$nextTick();
        expect(nums()).toEqual(['21.5°']);

        // A tap now builds on what is on screen, not on the stale 21.
        await raise().trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        expect(values().at(-1)).toBe('{"target_temp":22}');
    });

    it('ends the draft once the last command that sent it is answered', async () => {
        const w = await plusMinusPlus();
        for (const target of [21.5, 21, 21.5]) {
            changed(wireDevice({}, { target_temp: target }));
            await w.vm.$nextTick();
        }

        changed(wireDevice({}, { target_temp: 25 }));
        await w.vm.$nextTick();
        expect(nums()).toEqual(['25°']);
    });

    it('keeps the draft when the first command is refused while the third is still out', async () => {
        const w = await plusMinusPlus();

        const { msg_id: msgId } = JSON.parse(sent[0]);
        useHomeStore().applySetStateResult({ kind: 'set_state', msgId, success: false });
        await w.vm.$nextTick();

        expect(nums()).toEqual(['21.5°']);
    });

    it('keeps the draft when the first command times out while the third is still out', async () => {
        await plusMinusPlus();

        // Sent at 400 ms, 800 ms and 1200 ms: at 5.5 s the first one's 5 s are
        // up, the third one's are not.
        await vi.advanceTimersByTimeAsync(5500 - 1200);
        expect(nums()).toEqual(['21.5°']);
        await vi.advanceTimersByTimeAsync(1000);
        expect(nums()).toEqual(['21°']);
    });
});

describe('ClimateIo — a refused command', () => {
    it('puts the server value back as soon as the refusal arrives, not 5 s later', async () => {
        const w = mountClimate();
        await openSettings(w);
        await raise().trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        expect(nums()).toEqual(['21.5°']);

        // The server republishes the device unchanged, then says no.
        changed(wireDevice());
        await w.vm.$nextTick();
        refuseLast();
        await w.vm.$nextTick();

        expect(nums()).toEqual(['21°']);
    });

    it('does the same when the verdict comes before the republished device', async () => {
        const w = mountClimate();
        await openSettings(w);
        await raise().trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        refuseLast();
        await w.vm.$nextTick();
        expect(nums()).toEqual(['21°']);

        changed(wireDevice());
        await w.vm.$nextTick();
        expect(nums()).toEqual(['21°']);
    });

    it('keeps the value after an accepted verdict, until the device reports it', async () => {
        const w = mountClimate();
        await openSettings(w);
        await raise().trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        refuseLast(true);
        await w.vm.$nextTick();

        expect(nums()).toEqual(['21.5°']);
    });

    it('only retires the refused fields, not a newer choice made meanwhile', async () => {
        const w = mountClimate();
        await openSettings(w);
        await raise().trigger('click');
        await vi.advanceTimersByTimeAsync(400);
        await raise().trigger('click');
        refuseLast();
        await w.vm.$nextTick();

        expect(nums()).toEqual(['22°']);
    });
});

describe('ClimateIo — fan and swing commands', () => {
    async function openMore(w: VueWrapper) {
        await openSettings(w);
        await body().get('.climate-detail__more').trigger('click');
    }

    it('sends the chosen fan mode as a JSON partial update and keeps it ticked', async () => {
        const w = mountClimate();
        await openMore(w);

        await choice('High').trigger('click');
        expect(choice('High').attributes('aria-checked')).toBe('true');
        await vi.advanceTimersByTimeAsync(400);

        expect(values()).toEqual(['{"fan_mode":"high"}']);
    });

    it('sends swing the same way', async () => {
        const w = mountClimate();
        await openMore(w);

        await choice('Vertical').trigger('click');
        await vi.advanceTimersByTimeAsync(400);

        expect(values()).toEqual(['{"swing_mode":"vertical"}']);
    });

    it('merges fan, swing and a setpoint chosen together into one command', async () => {
        const w = mountClimate();
        await openSettings(w);
        await raise().trigger('click');
        await body().get('.climate-detail__more').trigger('click');
        await choice('Low').trigger('click');
        await choice('Vertical').trigger('click');
        await vi.advanceTimersByTimeAsync(400);

        expect(values().map((v) => JSON.parse(v))).toEqual([
            { target_temp: 21.5, fan_mode: 'low', swing_mode: 'vertical' },
        ]);
    });

    it('stays open after a choice, so both can be set, and closes with Close', async () => {
        const w = mountClimate();
        await openMore(w);
        await choice('High').trigger('click');
        expect(body().find('[role="radiogroup"]').exists()).toBe(true);

        const close = body().findAll('.base-dialog__button').find((b) => b.text() === 'Close')!;
        await close.trigger('click');
        expect(body().find('.climate-more__title').exists()).toBe(false);
    });
});

describe('ClimateIo — the lock-out countdown', () => {
    const waiting = (remaining: number, state: Wire = {}) =>
        wireDevice({}, { action: 'idle', lockout: { output: 'heat', remaining }, ...state });

    it('counts down locally from the seconds the server published', async () => {
        const w = mountClimate(waiting(140));
        await openSettings(w);
        expect(word().text()).toBe('Starts in 2 min 20');

        await vi.advanceTimersByTimeAsync(10_000);
        expect(word().text()).toBe('Starts in 2 min 10');

        await vi.advanceTimersByTimeAsync(75_000);
        expect(word().text()).toBe('Starts in 55 s');
    });

    it('fills the gauge with the share already waited', async () => {
        const w = mountClimate(waiting(100));
        await openSettings(w);
        expect(body().get('.climate-detail__gauge i').attributes('style')).toContain('0%');

        await vi.advanceTimersByTimeAsync(50_000);
        expect(body().get('.climate-detail__gauge i').attributes('style')).toContain('50%');
    });

    it('measures the gauge against the longest wait seen, not the latest publication', async () => {
        const w = mountClimate(waiting(100));
        await openSettings(w);

        // A republication 80 s later: 20 s left of a 100 s wait.
        changed(waiting(20));
        await w.vm.$nextTick();

        expect(body().get('.climate-detail__gauge i').attributes('style')).toContain('80%');
    });

    it('starts a new wait from zero once the previous one is over', async () => {
        const w = mountClimate(waiting(100));
        await openSettings(w);
        changed(wireDevice({}, { action: 'heating' }));
        await w.vm.$nextTick();

        changed(waiting(30));
        await w.vm.$nextTick();

        expect(body().get('.climate-detail__gauge i').attributes('style')).toContain('0%');
    });

    it('falls back to the action when the countdown ends before the server republishes', async () => {
        const w = mountClimate(waiting(3));
        await openSettings(w);
        expect(w.get('.climate-io__status').text()).toBe('Waiting');

        await vi.advanceTimersByTimeAsync(3000);
        expect(w.get('.climate-io__status').text()).toBe('Idle');
        expect(body().find('.climate-detail__gauge').exists()).toBe(false);
    });

    it('restarts from a new publication, and stops when the lock-out is gone', async () => {
        const w = mountClimate(waiting(140));
        await openSettings(w);
        await vi.advanceTimersByTimeAsync(60_000);

        changed(waiting(20));
        await w.vm.$nextTick();
        expect(word().text()).toBe('Starts in 20 s');

        changed(wireDevice({}, { action: 'heating' }));
        await w.vm.$nextTick();
        expect(word().text()).toBe('Heating');
        await vi.advanceTimersByTimeAsync(60_000);
        expect(word().text()).toBe('Heating');
    });

    it('stops its timer with the row', async () => {
        const w = mountClimate(waiting(140));
        w.unmount();
        mounted = [];

        expect(vi.getTimerCount()).toBe(0);
    });
});
