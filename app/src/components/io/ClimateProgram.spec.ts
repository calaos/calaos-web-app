import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import ClimateIo from './ClimateIo.vue';
import en from '../../i18n/en.json';
import fr from '../../i18n/fr.json';
import { closeClimate } from '../../composables/useClimatePanel';
import { toHomeData } from '../../protocol/guards';
import { useConnectionStore } from '../../stores/connection';
import { useHomeStore } from '../../stores/home';
import { useScheduleStore } from '../../stores/schedule';
import { fakeServer, wireRange } from '../../stores/scheduleTestHarness';
import type { FakeServer } from '../../stores/scheduleTestHarness';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en, fr } });

type Wire = Record<string, unknown>;

const CAPS = {
    modes: ['off', 'heat', 'cool', 'auto'],
    target_temp: { min: 16, max: 30, step: 0.5, unit: '°C', min_range: 2 },
    target_temp_range: true,
    reports_action: true,
    program: { heat_levels: 2, cool_levels: 2, max_levels: 6 },
};

const IOS = {
    mode: 'm',
    target_temp: 't',
    program_enabled: 'PE',
    heat_level1: 'H1',
    heat_level1_setpoint: 'H1S',
    heat_level2: 'H2',
    heat_level2_setpoint: 'H2S',
    cool_level1: 'C1',
    cool_level1_setpoint: 'C1S',
    heat_default: 'HD',
    cool_default: 'CD',
};

// 2026-11-18 10:00 local: the next change is at 13:20, 3 h 20 away.
const NOW = new Date(2026, 10, 18, 10, 0, 0);
const NEXT = new Date(2026, 10, 18, 13, 20, 0).toISOString();

function program(over: Wire = {}): Wire {
    return {
        enabled: true,
        mode_set: 'heat',
        heat: { levels: 2, active_level: 2, setpoint: 20.5, default: 17 },
        cool: { levels: 2, active_level: null, setpoint: null, default: null },
        next_change: { at: NEXT, set: 'heat', level: 1, setpoint: 22 },
        ...over,
    };
}

function device(opts: { caps?: Wire; state?: Wire; ios?: Wire; program?: Wire | null } = {}): Wire {
    const state: Wire = { mode: 'heat', current_temp: 21, target_temp: 21, target_temp_low: 19, target_temp_high: 24, action: 'heating', ...opts.state };
    if (opts.program !== null) state.program = opts.program ?? program();
    return { family: 'climate', impl: 'proxy', capabilities: { ...CAPS, ...opts.caps }, state, ios: opts.ios ?? IOS };
}

let mounted: VueWrapper[];
let server: FakeServer;

function mountClimate(wire: Wire = device()) {
    useHomeStore().setHome(
        toHomeData({ home: [{ name: 'Salon', items: [{ id: 'clim', name: 'Clim', gui_type: 'climate', state: 'heat', visible: 'true', device: wire }] }] }),
    );
    const w = mount(ClimateIo, { props: { io: useHomeStore().ios.get('clim')! }, global: { plugins: [i18n] }, attachTo: document.body });
    mounted.push(w);
    return w;
}

const body = () => new DOMWrapper(document.body);
const rowSwitch = (w: VueWrapper) => w.find('.climate-io__switch input');
const detailSwitch = () => body().find('.climate-detail__switch input');
const sentStates = () => server.sent.filter((f) => f.msg === 'set_state').map((f) => `${String(f.data.id)}=${String(f.data.value)}`);

async function openSettings(w: VueWrapper) {
    await w.get('[role="button"]').trigger('click');
    await flushPromises();
}

const changed = (wire: Wire) =>
    useHomeStore().handleEvent({
        kind: 'io_changed',
        id: 'clim',
        device: toHomeData({ home: [{ items: [{ id: 'x', device: wire }] }] }).rooms[0].items[0].device,
    });

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], now: NOW });
    setActivePinia(createPinia());
    mounted = [];
    window.matchMedia = ((query: string) => ({
        matches: query.includes('min-width: 64rem'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    useHomeStore().attachTransport(() => true);
    useConnectionStore().applyStatus({ status: 'open', attempt: 0, nextRetryMs: 0 });
    server = fakeServer();
    server.ranges.set('H1', [wireRange(3, 8, 0, 10, 0)]);
    server.ranges.set('C1', [wireRange(3, 14, 0, 16, 0)]);
});

afterEach(() => {
    for (const w of mounted) w.unmount();
    document.body.innerHTML = '';
    closeClimate();
    i18n.global.locale.value = 'en';
    vi.useRealTimers();
});

describe('ClimateIo — the program on the card', () => {
    it('says the active level and the next change on the row', () => {
        const w = mountClimate();
        expect(w.get('.climate-io__program').text()).toBe('Level 2 · 20.5° · ▶ 13:20');
    });

    it('says the program is paused, with the level that would apply, instead of the next change', () => {
        const w = mountClimate(device({ program: program({ enabled: false }) }));
        expect(w.get('.climate-io__program').text()).toBe('Program paused: level 2 (20.5°)');
        expect(rowSwitch(w).element).toHaveProperty('checked', false);
        expect(w.get('.climate-io__pause').text()).toBe('⏸');
        expect(w.get('.climate-io__pause').attributes('aria-hidden')).toBe('true');
    });

    it('shows no pause glyph while the program runs', () => {
        expect(mountClimate().find('.climate-io__pause').exists()).toBe(false);
    });

    it('says no level applies when the clock is in a gap', () => {
        const w = mountClimate(device({ program: program({ heat: { levels: 2, active_level: null, setpoint: null, default: 17 }, next_change: null }) }));
        expect(w.get('.climate-io__program').text()).toBe('No level now');
    });

    it('shows the switch on, and sends set_state on program_enabled when it is flipped', async () => {
        const w = mountClimate();
        const input = rowSwitch(w);
        expect(input.attributes('role')).toBe('switch');
        expect(input.element).toHaveProperty('checked', true);

        await input.setValue(false);
        await flushPromises();
        expect(sentStates()).toEqual(['PE=false']);
        // The server has not republished yet: the draft holds, then the server's word wins.
        expect(rowSwitch(w).element).toHaveProperty('checked', false);
        await vi.advanceTimersByTimeAsync(5000);
        expect(rowSwitch(w).element).toHaveProperty('checked', true);
    });

    it('follows the republished state', async () => {
        const w = mountClimate();
        await rowSwitch(w).setValue(false);
        await flushPromises();
        changed(device({ program: program({ enabled: false }) }));
        await flushPromises();
        expect(rowSwitch(w).element).toHaveProperty('checked', false);
        expect(w.get('.climate-io__program').text()).toContain('Program paused');
        await vi.advanceTimersByTimeAsync(5000);
        expect(rowSwitch(w).element).toHaveProperty('checked', false);
    });

    it('keeps the switch reachable by its role: outside the button, nothing interactive nested in it', () => {
        const w = mountClimate();
        const button = w.get('[role="button"]');
        expect(w.findAll('[role="switch"]')).toHaveLength(1);
        expect(button.find('[role="switch"], input, button, a, select').exists()).toBe(false);
        expect(button.element.contains(rowSwitch(w).element)).toBe(false);
    });

    it('does not open the settings on Space or Enter on the switch', async () => {
        const w = mountClimate();
        await rowSwitch(w).trigger('keydown', { key: ' ' });
        await rowSwitch(w).trigger('keydown', { key: 'Enter' });
        await rowSwitch(w).trigger('keyup', { key: ' ' });
        await flushPromises();
        expect(body().find('.climate-panel').exists()).toBe(false);
    });

    it('does not open the settings when the switch is tapped', async () => {
        const w = mountClimate();
        await rowSwitch(w).trigger('click');
        await flushPromises();
        expect(body().find('.climate-panel').exists()).toBe(false);
    });

    it('drops the draft and says so when the server refuses', async () => {
        const w = mountClimate();
        server.refuseValue = () => true;
        await openSettings(w);
        await detailSwitch().setValue(false);
        await flushPromises();
        expect(detailSwitch().element).toHaveProperty('checked', true);
        expect(body().get('.climate-detail__error').text()).toBe('The program was not changed. Try again.');
    });

    it('says it is offline instead of sending when the socket is closed', async () => {
        const w = mountClimate();
        server.online = false;
        await openSettings(w);
        await detailSwitch().setValue(false);
        await flushPromises();
        expect(body().get('.climate-detail__error').text()).toBe('Not sent: you are offline.');
        expect(sentStates()).toEqual([]);
    });

    it('disables the switch when offline or when the device has no program_enabled IO', async () => {
        useConnectionStore().applyStatus({ status: 'reconnecting', attempt: 1, nextRetryMs: 1000 });
        const w = mountClimate();
        expect(rowSwitch(w).attributes('disabled')).toBeDefined();
        w.unmount();
        mounted = [];

        useConnectionStore().applyStatus({ status: 'open', attempt: 0, nextRetryMs: 0 });
        const ios = Object.fromEntries(Object.entries(IOS).filter(([key]) => key !== 'program_enabled'));
        const w2 = mountClimate(device({ ios }));
        expect(rowSwitch(w2).attributes('disabled')).toBeDefined();
        await rowSwitch(w2).trigger('change');
        expect(sentStates()).toEqual([]);
    });

    it('hides everything about the program without capabilities.program', async () => {
        const caps = { ...CAPS } as Wire;
        delete caps.program;
        const w = mountClimate({ ...device({ program: null }), capabilities: caps });
        expect(w.find('.climate-io__switch').exists()).toBe(false);
        expect(w.find('.climate-io__program').exists()).toBe(false);

        await openSettings(w);
        expect(body().find('.climate-detail__program').exists()).toBe(false);
        expect(body().text()).not.toContain('Edit program');
        expect(server.sent).toEqual([]);
    });

    it('waits for state.program: no switch on the row, a placeholder in the detail', async () => {
        const w = mountClimate(device({ program: null }));
        expect(w.find('.climate-io__switch').exists()).toBe(false);
        expect(w.find('.climate-io__program').exists()).toBe(false);

        await openSettings(w);
        expect(body().get('.climate-detail__skeleton').text()).toBe('Loading the program…');
        expect(detailSwitch().exists()).toBe(false);

        changed(device());
        await flushPromises();
        expect(body().find('.climate-detail__skeleton').exists()).toBe(false);
        expect(detailSwitch().exists()).toBe(true);
    });
});

describe('ClimateDetail — the program', () => {
    it('reads the active level and the next change, with the countdown', async () => {
        const w = mountClimate();
        await openSettings(w);
        expect(body().get('.climate-detail__active').text()).toBe('Level 2 · 20.5°');
        expect(body().get('.climate-detail__next').text()).toBe('13:20, Heating level 1 at 22° (in 3 h 20)');

        await vi.advanceTimersByTimeAsync(2 * 3600_000);
        expect(body().get('.climate-detail__next').text()).toBe('13:20, Heating level 1 at 22° (in 1 h 20)');
    });

    it('names the weekday when the next change is not today, and says when nothing is planned', async () => {
        const w = mountClimate(device({ program: program({ next_change: { at: new Date(2026, 10, 19, 6, 0).toISOString(), set: 'cool', level: null, setpoint: null } }) }));
        await openSettings(w);
        expect(body().get('.climate-detail__next').text()).toBe('Thu 06:00, Cooling off (in 20 h 00)');

        changed(device({ program: program({ next_change: null }) }));
        await flushPromises();
        expect(body().get('.climate-detail__next').text()).toBe('No change in the next 7 days');
    });

    it('replaces the level and the next change by the pause line when paused', async () => {
        const w = mountClimate(device({ program: program({ enabled: false }) }));
        await openSettings(w);
        expect(body().get('.climate-detail__paused').text()).toBe('Program paused: level 2 (20.5°)');
        expect(body().find('.climate-detail__active').exists()).toBe(false);
        expect(body().find('.climate-detail__next').exists()).toBe(false);
    });

    it('flips the program from the detail with the same write', async () => {
        const w = mountClimate();
        await openSettings(w);
        await detailSwitch().setValue(false);
        await flushPromises();
        expect(sentStates()).toEqual(['PE=false']);
    });

    it('draws one strip for the direction in force, with the default and no range in heat', async () => {
        const w = mountClimate();
        await openSettings(w);
        const strips = body().findAll('.climate-detail__strips [role="group"]');
        expect(strips.map((s) => s.attributes('aria-label'))).toEqual(['Today, Heating']);
        expect(body().find('.climate-detail__fork').exists()).toBe(false);
        expect(body().find('.climate-detail__hatch').exists()).toBe(false);
    });

    it('draws the strip of the direction that applies, and re-reads it when a range changes', async () => {
        const w = mountClimate(device({ program: program({ mode_set: 'cool' }) }));
        await openSettings(w);
        expect(body().findAll('.climate-detail__strips [role="group"]').map((s) => s.attributes('aria-label'))).toEqual(['Today, Cooling']);

        const reads = server.sent.filter((f) => f.msg === 'get_timerange').length;
        useScheduleStore().applyTimerangeChanged({ id: 'unrelated' });
        await flushPromises();
        expect(server.sent.filter((f) => f.msg === 'get_timerange').length).toBe(reads);

        useScheduleStore().applyTimerangeChanged({ id: 'C1' });
        await flushPromises();
        expect(server.sent.filter((f) => f.msg === 'get_timerange').length).toBeGreaterThan(reads);
    });

    it('in auto: shows the range, the help on demand, and both strips with the hatching between', async () => {
        const w = mountClimate(device({ state: { mode: 'auto' }, program: program({ mode_set: 'auto' }) }));
        await openSettings(w);
        expect(body().get('.climate-detail__fork span').text()).toBe('Range 19° – 24°');

        const help = body().get('.climate-detail__help');
        expect(help.attributes('aria-expanded')).toBe('false');
        expect(body().find('.climate-detail__helptext').exists()).toBe(false);
        await help.trigger('click');
        expect(help.attributes('aria-expanded')).toBe('true');
        expect(body().get('.climate-detail__helptext').text()).toBe('In auto, heating stays below cooling and the two stay at least 2° apart.');
        expect(help.attributes('aria-controls')).toBe(body().get('.climate-detail__helptext').attributes('id'));
        await help.trigger('click');
        expect(body().find('.climate-detail__helptext').exists()).toBe(false);

        const kids = body().get('.climate-detail__strips').element.children;
        expect([...kids].map((k) => k.getAttribute('aria-label'))).toEqual(['Today, Heating', 'Between heating and cooling', 'Today, Cooling']);
    });

    it('in auto: falls back on the program setpoints when the device publishes no range, and on the plain help without min_range', async () => {
        const target_temp = { min: 16, max: 30, step: 0.5, unit: '°C' };
        const w = mountClimate(
            device({
                caps: { target_temp },
                state: { mode: 'auto', target_temp_low: undefined, target_temp_high: undefined },
                program: program({
                    mode_set: 'auto',
                    heat: { levels: 2, active_level: 2, setpoint: 20.5, default: 17 },
                    cool: { levels: 2, active_level: 1, setpoint: 25, default: 28 },
                }),
            }),
        );
        await openSettings(w);
        expect(body().get('.climate-detail__fork span').text()).toBe('Range 20.5° – 25°');
        await body().get('.climate-detail__help').trigger('click');
        expect(body().get('.climate-detail__helptext').text()).toBe('In auto, heating stays below cooling, with a minimum gap between the two.');
    });

    it('outside auto: no range, no help', async () => {
        const w = mountClimate();
        await openSettings(w);
        expect(body().find('.climate-detail__help').exists()).toBe(false);
    });

    it('opens the editor from the detail, with the Heating and Cooling tabs', async () => {
        const w = mountClimate();
        await openSettings(w);
        const edit = body().findAll('button').find((b) => b.text() === 'Edit program')!;
        await edit.trigger('click');
        await flushPromises();
        const tabs = body().findAll('.schedule__tabs [role="tab"]');
        expect(tabs.map((t) => t.text())).toEqual(expect.arrayContaining([expect.stringContaining('Heating'), expect.stringContaining('Cooling')]));
        expect(tabs.map((t) => t.attributes('aria-selected'))).toEqual(['true', 'false']);
    });

    it('speaks French', async () => {
        i18n.global.locale.value = 'fr';
        const w = mountClimate();
        expect(w.get('.climate-io__program').text()).toMatch(/^Niveau 2 · 20,5° · ▶ 13:20$/);
        await openSettings(w);
        expect(body().get('.climate-detail__next').text()).toContain('Chauffage niveau 1');
    });
});
