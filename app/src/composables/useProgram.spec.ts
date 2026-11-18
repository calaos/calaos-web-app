import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import en from '../i18n/en.json';
import { toHomeData } from '../protocol/guards';
import { useConnectionStore } from '../stores/connection';
import { useHomeStore } from '../stores/home';
import { fakeServer } from '../stores/scheduleTestHarness';
import type { FakeServer } from '../stores/scheduleTestHarness';
import { useProgram } from './useProgram';
import type { UseProgram } from './useProgram';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });

type Wire = Record<string, unknown>;

const NOW = new Date(2026, 10, 18, 10, 0, 0);
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const MIN = 60_000;

function wire(program: Wire | null, ios: Wire = { program_enabled: 'PE' }, withCap = true): Wire {
    return {
        family: 'climate',
        impl: 'proxy',
        capabilities: { modes: ['heat'], ...(withCap ? { program: { heat_levels: 2, cool_levels: 2, max_levels: 6 } } : {}) },
        state: { mode: 'heat', ...(program ? { program } : {}) },
        ios,
    };
}

const state = (over: Wire = {}): Wire => ({
    enabled: true,
    mode_set: 'heat',
    heat: { levels: 2, active_level: 1, setpoint: 20, default: 17 },
    cool: { levels: 2, active_level: null, setpoint: null, default: null },
    next_change: { at: at(45 * MIN), set: 'heat', level: 2, setpoint: 21.5 },
    ...over,
});

const scope = { stop: () => {} };
let pinia: ReturnType<typeof createPinia>;
let server: FakeServer;

function setup(device: Wire): UseProgram {
    useHomeStore().setHome(toHomeData({ home: [{ items: [{ id: 'c', name: 'C', gui_type: 'climate', state: '', visible: 'true', device }] }] }));
    let result!: UseProgram;
    const w = mount(
        defineComponent({
            setup() {
                result = useProgram(() => useHomeStore().ios.get('c')!);
                return () => null;
            },
        }),
        { global: { plugins: [pinia, i18n] } },
    );
    scope.stop = () => w.unmount();
    return result;
}

const publish = (device: Wire) =>
    useHomeStore().handleEvent({ kind: 'io_changed', id: 'c', device: toHomeData({ home: [{ items: [{ id: 'x', device }] }] }).rooms[0].items[0].device });

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], now: NOW });
    pinia = createPinia();
    setActivePinia(pinia);
    useConnectionStore().applyStatus({ status: 'open', attempt: 0, nextRetryMs: 0 });
    server = fakeServer();
});

afterEach(() => {
    scope.stop();
    vi.useRealTimers();
});

describe('useProgram — availability', () => {
    it('is unavailable without the capability, available and loading until the state arrives', () => {
        const none = setup(wire(null, undefined, false));
        expect([none.available.value, none.loading.value]).toEqual([false, false]);
        scope.stop();

        const waiting = setup(wire(null));
        expect([waiting.available.value, waiting.loading.value]).toEqual([true, true]);
        publish(wire(state()));
        expect([waiting.available.value, waiting.loading.value]).toEqual([true, false]);
    });
});

describe('useProgram — toggle', () => {
    it('writes program_enabled with the opposite of what is shown, and holds the draft until the server speaks', async () => {
        const p = setup(wire(state()));
        await p.toggle();
        expect(server.sent.map((f) => f.data)).toMatchObject([{ id: 'PE', value: 'false' }]);
        expect(p.enabled.value).toBe(false);
        expect(p.saving.value).toBe(false);

        publish(wire(state({ enabled: false })));
        await nextTick();
        expect(p.enabled.value).toBe(false);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(p.enabled.value).toBe(false);
    });

    it('gives the draft up after 5 s of silence and shows what the server last said', async () => {
        const p = setup(wire(state()));
        await p.toggle();
        await vi.advanceTimersByTimeAsync(4999);
        expect(p.enabled.value).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(p.enabled.value).toBe(true);
    });

    it('lets the server override a draft, whatever it says', async () => {
        const p = setup(wire(state()));
        await p.toggle();
        publish(wire(state({ enabled: false })));
        await nextTick();
        publish(wire(state({ enabled: true })));
        await nextTick();
        expect(p.enabled.value).toBe(true);
    });

    it('clears a draft the server confirmed in the meantime', async () => {
        const p = setup(wire(state({ enabled: false })));
        server.refuseValue = () => false;
        const writing = p.toggle();
        publish(wire(state({ enabled: true })));
        await writing;
        await vi.advanceTimersByTimeAsync(10_000);
        expect(p.enabled.value).toBe(true);
        expect(p.error.value).toBe('');
    });

    it('reports a refusal and a closed socket differently, and forgets the error on the next try', async () => {
        const p = setup(wire(state()));
        server.refuseValue = () => true;
        await p.toggle();
        expect(p.error.value).toBe('The program was not changed. Try again.');
        expect(p.enabled.value).toBe(true);

        server.refuseValue = () => false;
        server.online = false;
        await p.toggle();
        expect(p.error.value).toBe('Not sent: you are offline.');

        server.online = true;
        await p.toggle();
        expect(p.error.value).toBe('');
    });

    it('ignores a second tap while the first is in flight', async () => {
        const p = setup(wire(state()));
        server.silent.add('PE');
        void p.toggle();
        await nextTick();
        expect(p.saving.value).toBe(true);
        await p.toggle();
        expect(server.sent).toHaveLength(1);
    });

    it('does nothing when read-only or before the state is known', async () => {
        const noIo = setup(wire(state(), {}));
        expect(noIo.readonly.value).toBe(true);
        await noIo.toggle();
        scope.stop();

        const loading = setup(wire(null));
        await loading.toggle();
        scope.stop();

        const closed = setup(wire(state()));
        useConnectionStore().applyStatus({ status: 'closed', attempt: 1, nextRetryMs: 1000 });
        expect(closed.readonly.value).toBe(true);
        await closed.toggle();
        expect(server.sent).toEqual([]);
    });
});

describe('useProgram — the next change', () => {
    it('counts down in minutes, hours and days, and refreshes by itself', async () => {
        const p = setup(wire(state({ next_change: { at: at(25 * 3600_000 + 5 * MIN), set: 'cool', level: 1, setpoint: 25 } })));
        expect(p.nextIn.value).toBe('in 1 d 1 h');
        await vi.advanceTimersByTimeAsync(24 * 3600_000);
        expect(p.nextIn.value).toBe('in 1 h 05');
        await vi.advanceTimersByTimeAsync(MIN * 30);
        expect(p.nextIn.value).toBe('in 35 min');
        await vi.advanceTimersByTimeAsync(MIN * 35);
        expect(p.nextIn.value).toBe('in under a minute');
        await vi.advanceTimersByTimeAsync(10 * MIN);
        expect(p.nextIn.value).toBe('in under a minute');
    });

    it('starts its clock with a change and stops it when there is none', async () => {
        const p = setup(wire(state({ next_change: null })));
        expect(vi.getTimerCount()).toBe(0);
        expect([p.nextIn.value, p.nextTime.value]).toEqual(['', '']);
        expect(p.nextText.value).toBe('No change in the next 7 days');

        publish(wire(state()));
        await nextTick();
        expect(vi.getTimerCount()).toBe(1);
        expect(p.nextText.value).toBe('10:45, Heating level 2 at 21.5° (in 45 min)');

        publish(wire(state({ next_change: null })));
        await nextTick();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('says a direction is switched off when the change has no level', () => {
        const p = setup(wire(state({ next_change: { at: at(2 * 3600_000), set: 'cool', level: null, setpoint: null } })));
        expect(p.nextText.value).toBe('12:00, Cooling off (in 2 h 00)');
    });

    it('stops its timers with its scope, the ticker and a pending draft', async () => {
        const p = setup(wire(state()));
        await p.toggle();
        expect(vi.getTimerCount()).toBe(2);
        scope.stop();
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('useProgram — the set in force', () => {
    it('follows mode_set, and the direction of the next change in auto', () => {
        const heat = setup(wire(state()));
        expect(heat.activeText.value).toBe('Level 1 · 20°');
        scope.stop();

        const cool = setup(wire(state({ mode_set: 'cool', cool: { levels: 2, active_level: 2, setpoint: 25.5, default: null } })));
        expect(cool.activeText.value).toBe('Level 2 · 25.5°');
        scope.stop();

        const auto = setup(
            wire(state({ mode_set: 'auto', cool: { levels: 2, active_level: 2, setpoint: 25, default: null }, next_change: { at: at(MIN * 90), set: 'cool', level: 1, setpoint: 26 } })),
        );
        expect(auto.current.value?.setpoint).toBe(25);
    });

    it('in auto without a next change, takes heating when it exists, else cooling', () => {
        const auto = setup(wire(state({ mode_set: 'auto', next_change: null })));
        expect(auto.current.value?.setpoint).toBe(20);
        scope.stop();

        const coolOnly = setup(
            wire(state({ mode_set: null, heat: undefined, cool: { levels: 2, active_level: 1, setpoint: 24, default: null }, next_change: null })),
        );
        expect(coolOnly.current.value?.setpoint).toBe(24);
    });

    it('says no level applies, and what the pause covers', () => {
        const gap = setup(wire(state({ heat: { levels: 2, active_level: null, setpoint: null, default: 17 }, enabled: false })));
        expect(gap.activeText.value).toBe('No level now');
        expect(gap.pausedText.value).toBe('Program paused');
        scope.stop();

        const level = setup(wire(state({ enabled: false })));
        expect(level.pausedText.value).toBe('Program paused: level 1 (20°)');
        scope.stop();

        const none = setup(wire(null));
        expect(none.current.value).toBeUndefined();
        expect(none.activeText.value).toBe('No level now');
    });

    it('shows half degrees', () => {
        const p = setup(wire(state({ heat: { levels: 2, active_level: 1, setpoint: 20.5, default: 17 } })));
        expect(p.activeText.value).toBe('Level 1 · 20.5°');
    });
});
