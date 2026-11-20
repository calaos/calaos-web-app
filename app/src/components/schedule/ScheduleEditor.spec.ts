import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import type { DOMWrapper, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { messages } from '../../i18n/messages';
import type { WireRange } from '../../protocol/schedule';
import type { IoItem } from '../../protocol/types';
import { useConnectionStore } from '../../stores/connection';
import { useScheduleStore } from '../../stores/schedule';
import { fakeServer, wireRange } from '../../stores/scheduleTestHarness';
import type { FakeServer } from '../../stores/scheduleTestHarness';
import ScheduleEditor from './ScheduleEditor.vue';

enableAutoUnmount(beforeEach);

afterEach(() => {
    vi.useRealTimers();
});

// IO ids: H1..H6 / C1..C6 are the level ranges, H1S.. their setpoints.
const levelIds = (dir: 'H' | 'C', n: number) => ({ id: `${dir}${String(n)}`, setpointId: `${dir}${String(n)}S` });

function climateIos(opts: { levels?: number; heat?: boolean; cool?: boolean; coolOff?: boolean } = {}): Record<string, string> {
    const { levels = 6, heat = true, cool = true, coolOff = true } = opts;
    const ios: Record<string, string> = {};
    for (let n = 1; n <= levels; n++) {
        if (heat) {
            ios[`heat_level${String(n)}`] = levelIds('H', n).id;
            ios[`heat_level${String(n)}_setpoint`] = levelIds('H', n).setpointId;
        }
        if (cool) {
            ios[`cool_level${String(n)}`] = levelIds('C', n).id;
            ios[`cool_level${String(n)}_setpoint`] = levelIds('C', n).setpointId;
        }
    }
    if (heat) ios.heat_default = 'HD';
    if (cool) ios.cool_default = 'CD';
    if (cool && coolOff) ios.cool_default_off = 'CO';
    return ios;
}

interface Options {
    readonly?: boolean;
    ios?: Record<string, string>;
    /** Level n (1..6) → ranges the server holds for it. */
    heat?: Record<number, WireRange[]>;
    cool?: Record<number, WireRange[]>;
    /** Level n → setpoint; defaults: heat 24 - 2n, cool 24 + n. */
    heatSetpoints?: Record<number, number>;
    coolSetpoints?: Record<number, number>;
    coolOff?: boolean;
    prepare?: (server: FakeServer) => void;
    keepConnectionClosed?: boolean;
}

interface Mounted {
    wrapper: VueWrapper;
    server: FakeServer;
}

async function mountEditor(opts: Options = {}): Promise<Mounted> {
    setActivePinia(createPinia());
    const server = fakeServer();
    if (!opts.keepConnectionClosed) useConnectionStore().applyStatus({ status: 'open', attempt: 0, nextRetryMs: 0 });
    for (let n = 1; n <= 6; n++) {
        server.values.set(levelIds('H', n).setpointId, String(opts.heatSetpoints?.[n] ?? 24 - 2 * n));
        server.values.set(levelIds('C', n).setpointId, String(opts.coolSetpoints?.[n] ?? 24 + n));
        server.ranges.set(levelIds('H', n).id, opts.heat?.[n] ?? []);
        server.ranges.set(levelIds('C', n).id, opts.cool?.[n] ?? []);
    }
    server.values.set('HD', '19');
    server.values.set('CD', '26');
    server.values.set('CO', opts.coolOff ? 'true' : 'false');
    opts.prepare?.(server);
    const io = { device: { ios: opts.ios ?? climateIos() } } as unknown as IoItem;
    const wrapper = mount(ScheduleEditor, {
        props: { io, readonly: opts.readonly ?? false },
        global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] },
    });
    await flushPromises();
    return { wrapper, server };
}

describe('program paused', () => {
    it('says the slots do not apply and offers to resume, none when the program runs', async () => {
        const io = (enabled: boolean) =>
            ({ device: { ios: { ...climateIos(), program_enabled: 'PE' }, capabilities: { program: {} }, state: { program: { enabled } } } }) as unknown as IoItem;
        const run = async (enabled: boolean) => {
            const { wrapper } = await mountEditor({ prepare: () => {} });
            await wrapper.setProps({ io: io(enabled) });
            return wrapper;
        };
        const paused = await run(false);
        const banner = paused.get('.week__state--paused');
        expect(banner.attributes('role')).toBe('status');
        expect(banner.text()).toContain('Program paused');
        expect(banner.find('button').text()).toBe('Resume');
        expect((await run(true)).find('.week__state--paused').exists()).toBe(false);
    });

    describe('Resume', () => {
        const pausedIo = () =>
            ({ device: { ios: { ...climateIos(), program_enabled: 'PE' }, capabilities: { program: {} }, state: { program: { enabled: false } } } }) as unknown as IoItem;
        const runningIo = () =>
            ({ device: { ios: { ...climateIos(), program_enabled: 'PE' }, capabilities: { program: {} }, state: { program: { enabled: true } } } }) as unknown as IoItem;
        const mountPaused = async (refuse: boolean) => {
            const m = await mountEditor({ prepare: (server) => (server.refuseValue = () => refuse) });
            await m.wrapper.setProps({ io: pausedIo() });
            return m;
        };
        const setStates = (server: FakeServer) => server.sent.filter((f) => f.msg === 'set_state');

        it('sends program_enabled=true when clicked', async () => {
            const { wrapper, server } = await mountPaused(false);
            await wrapper.get('.week__state--paused button').trigger('click');
            await flushPromises();
            const sent = setStates(server);
            expect(sent).toHaveLength(1);
            expect(sent[0]?.data).toMatchObject({ id: 'PE', value: 'true' });
            expect(wrapper.find('.schedule__notice').exists()).toBe(false);
        });

        it('says so when the server refuses, instead of staying silent', async () => {
            const { wrapper, server } = await mountPaused(true);
            await wrapper.get('.week__state--paused button').trigger('click');
            await flushPromises();
            expect(setStates(server)).toHaveLength(1);
            const alert = wrapper.get('.schedule__notice');
            expect(alert.attributes('role')).toBe('alert');
            expect(alert.text()).toBe(messages.en.program.error.generic);
            expect(wrapper.find('.week__state--paused').exists()).toBe(true);
        });

        it('drops the refusal when another client turns the program back on', async () => {
            const { wrapper } = await mountPaused(true);
            await wrapper.get('.week__state--paused button').trigger('click');
            await flushPromises();
            expect(wrapper.find('.schedule__notice').exists()).toBe(true);
            await wrapper.setProps({ io: runningIo() });
            await flushPromises();
            expect(wrapper.find('.schedule__notice').exists()).toBe(false);
            expect(wrapper.find('.week__state--paused').exists()).toBe(false);
        });

        it('forgets a refusal on the next click, which the server then takes', async () => {
            const { wrapper, server } = await mountPaused(true);
            await wrapper.get('.week__state--paused button').trigger('click');
            await flushPromises();
            expect(wrapper.find('.schedule__notice').exists()).toBe(true);
            server.refuseValue = () => false;
            await wrapper.get('.week__state--paused button').trigger('click');
            await flushPromises();
            expect(setStates(server)).toHaveLength(2);
            expect(wrapper.find('.schedule__notice').exists()).toBe(false);
        });
    });
});

// ------------------------------------------------------------- helpers ---

const text = (w: VueWrapper) => w.text().replace(/\s+/g, ' ');

type Root = { findAll(selector: string): DOMWrapper<Element>[] };

function button(root: Root, label: string) {
    const found = root.findAll('button').find((b) => b.text() === label);
    if (!found) throw new Error(`no button "${label}"`);
    return found;
}

async function toWeek(w: VueWrapper): Promise<void> {
    const back = w.find('.day__back');
    if (back.exists()) {
        await back.trigger('click');
        await flushPromises();
    }
}

/** Opens the day list of one day (from the week, whichever view is showing). */
async function selectDay(w: VueWrapper, name: string): Promise<void> {
    await toWeek(w);
    const row = w.findAll('button.week__row').find((b) => b.attributes('aria-label')?.startsWith(`${name}, `));
    if (!row) throw new Error(`no week row "${name}"`);
    await row.trigger('click');
}

/** Switches the direction tab; the tabs live on the week view. */
async function openTab(w: VueWrapper, label: string): Promise<void> {
    await toWeek(w);
    await button(w, label.replace(/ \(\d+\)$/, '')).trigger('click');
    await flushPromises();
}

/** The period rows of the day shown, as "08:00 – 10:00, 20°". */
const segments = (w: VueWrapper) =>
    w.findAll('button.day__row[aria-label^="Edit "]').map((b) => b.attributes('aria-label')?.replace(/^Edit /, ''));

const periodRow = (w: VueWrapper, n = 0) => w.findAll('button.day__row[aria-label^="Edit "]')[n];

/** The period view; it replaces the day while a period is open. */
const form = (w: VueWrapper) => w.find('.period');

/** set_state and set_timerange frames after `from`, as "msg:id[=value]". */
function writes(server: FakeServer, from = 0): string[] {
    return server.sent
        .slice(from)
        .filter((f) => f.msg === 'set_state' || f.msg === 'set_timerange')
        .map((f) => (f.msg === 'set_state' ? `set_state:${String(f.data.id)}=${String(f.data.value)}` : `set_timerange:${String(f.data.id)}`));
}

const reads = (server: FakeServer, from = 0) =>
    server.sent
        .slice(from)
        .filter((f) => f.msg === 'get_timerange')
        .map((f) => String(f.data.id));

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Drives the steppers of the period view to the wanted values. */
async function fillForm(w: VueWrapper, v: { start?: string; end?: string; setpoint?: number }): Promise<void> {
    const f = form(w);
    const click = (label: string) => f.get(`button[aria-label="${label}"]`).trigger('click');
    const time = async (field: 'Start' | 'End', want: string, key: string) => {
        const read = () => minutesOf(f.get(`[data-test="${key}"]`).text().slice(0, 5));
        const target = minutesOf(want);
        const span = 1440;
        const forward = (((target - read()) % span) + span) % span;
        const up = forward <= span / 2;
        for (let n = 0; n < Math.round((up ? forward : span - forward) / 15); n++) await click(`${field} ${up ? 'Increase' : 'Decrease'}`);
    };
    if (v.start !== undefined) await time('Start', v.start, 'start');
    if (v.end !== undefined) await time('End', v.end, 'end');
    if (v.setpoint !== undefined) {
        const read = () => Number(f.get('[data-test="setpoint"]').text().replace('°', ''));
        for (let guard = 0; read() !== v.setpoint && guard < 120; guard++) await click(`Temperature ${read() < v.setpoint ? 'Increase' : 'Decrease'}`);
    }
}

const MON_8_10 = wireRange(1, 8, 0, 10, 0);

// ------------------------------------------------------------- reading ---

describe('reading the program', () => {
    it('asks for the values once and reads every level of both directions', async () => {
        const { server } = await mountEditor();
        const states = server.sent.filter((f) => f.msg === 'get_state');
        expect(states).toHaveLength(1);
        // The level IOs carry ranges, not a state: only setpoints and defaults are watched.
        const watched = Object.values(climateIos()).filter((id) => /S$|^(HD|CD|CO)$/.test(id));
        expect([...(states[0].data.items as string[])].sort()).toEqual(watched.sort());
        expect(watched).toHaveLength(15);
        expect(reads(server).sort()).toEqual(
            ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6'].sort(),
        );
        expect(writes(server)).toEqual([]);
    });

    it('names the Heating and Cooling tabs without a counter', async () => {
        const { wrapper } = await mountEditor({
            heat: { 1: [MON_8_10], 2: [wireRange(1, 12, 0, 14, 0)] },
            cool: { 1: [wireRange(2, 14, 0, 16, 0)] },
        });
        const tabs = wrapper.findAll('[role="tab"]').map((t) => t.text());
        expect(tabs).toEqual(['Heating', 'Cooling']);
        await openTab(wrapper, 'Cooling');
    });

    it('ignores a seventh level and reads only the IOs it was given', async () => {
        const ios = { ...climateIos({ cool: false }), heat_level7: 'H7', heat_level7_setpoint: 'H7S' };
        const { wrapper, server } = await mountEditor({ ios });
        expect(reads(server)).not.toContain('H7');
        expect(wrapper.find('.week__tabs').exists()).toBe(false);
    });

    it('shows the level of a slot on the track with its setpoint', async () => {
        const { wrapper } = await mountEditor({ heat: { 2: [MON_8_10] } });
        await selectDay(wrapper, 'Monday');
        expect(segments(wrapper)).toEqual(['08:00 – 10:00, 20°']);
    });

    it('lets level 1 win over a lower priority slot that overlaps it', async () => {
        const { wrapper } = await mountEditor({
            heat: { 1: [wireRange(1, 8, 0, 12, 0)], 2: [wireRange(1, 10, 0, 14, 0)] },
        });
        await selectDay(wrapper, 'Monday');
        expect(segments(wrapper)).toEqual(['08:00 – 12:00, 22°', '10:00 – 14:00, 20°']);
    });

    it('counts a sunrise range as a used level and gives a new setpoint the next one', async () => {
        const sunrise: WireRange = { ...wireRange(1, 0, 0, 0, 0), start_type: '1', start_offset: '30', end_hour: '9' };
        const { wrapper, server } = await mountEditor({ heat: { 1: [sunrise] } });
        await selectDay(wrapper, 'Monday');
        await button(wrapper, 'Add a period').trigger('click');
        // 22.5 is not level 1's setpoint: the kept range makes level 1 busy, so the slot takes level 2.
        await fillForm(wrapper, { setpoint: 22.5 });
        const mark = server.sent.length;
        await button(form(wrapper), 'Save').trigger('click');
        await flushPromises();
        expect(writes(server, mark)).toEqual(['set_state:H2S=22.5', 'set_timerange:H2']);
        expect(server.writesOf('H1')).toEqual([]);
    });
});

describe('week and day views', () => {
    it('opens on the week, goes into a day from its row and comes back by name', async () => {
        const { wrapper } = await mountEditor({ heat: { 1: [MON_8_10] } });
        expect(wrapper.find('.week').exists()).toBe(true);
        expect(wrapper.find('.day').exists()).toBe(false);
        await selectDay(wrapper, 'Monday');
        expect(wrapper.find('.week').exists()).toBe(false);
        expect(wrapper.get('.day__title').text()).toBe('Monday');
        await button(wrapper, 'Week').trigger('click');
        expect(wrapper.find('.week').exists()).toBe(true);
    });

    it('goes back to the week on Escape and stops it there, only from a day', async () => {
        const { wrapper } = await mountEditor({ heat: { 1: [MON_8_10] } });
        const outer = vi.fn();
        const host = wrapper.element.parentElement!;
        host.addEventListener('keydown', outer);
        await wrapper.get('.schedule').trigger('keydown', { key: 'Escape' });
        expect(outer).toHaveBeenCalledTimes(1);
        await selectDay(wrapper, 'Monday');
        await wrapper.get('.schedule').trigger('keydown', { key: 'Escape' });
        expect(wrapper.find('.week').exists()).toBe(true);
        expect(outer).toHaveBeenCalledTimes(1);
        host.removeEventListener('keydown', outer);
    });

    it('lists the periods as rows and opens nothing when the preview bar is clicked', async () => {
        const { wrapper } = await mountEditor({ heat: { 1: [MON_8_10] } });
        await selectDay(wrapper, 'Monday');
        await wrapper.get('.track').trigger('click');
        expect(form(wrapper).exists()).toBe(false);
        await periodRow(wrapper).trigger('click');
        expect(form(wrapper).exists()).toBe(true);
    });

    it('names the day in the week row and the period count', async () => {
        const { wrapper } = await mountEditor({ heat: { 1: [MON_8_10] } });
        const labels = wrapper.findAll('button.week__row').map((b) => b.attributes('aria-label'));
        expect(labels[0]).toMatch(/^Monday, Heating, 1 period/);
    });
});

// -------------------------------------------------------------- helpers ---

/** n levels each holding one Monday hour, so every level counts as used. */
function levelsInUse(n: number): Record<number, WireRange[]> {
    const out: Record<number, WireRange[]> = {};
    for (let k = 1; k <= n; k++) out[k] = [wireRange(1, 2 * k, 0, 2 * k + 1, 0)];
    return out;
}

const banner = (w: VueWrapper) => w.find('.schedule__banner');
const notice = (w: VueWrapper) => w.find('.schedule__notice');
const setTimeranges = (server: FakeServer) => server.sent.filter((f) => f.msg === 'set_timerange');

async function addSlot(w: VueWrapper, v: Parameters<typeof fillForm>[1]): Promise<void> {
    await selectDay(w, 'Monday');
    await button(w, 'Add a period').trigger('click');
    await fillForm(w, v);
}

async function save(w: VueWrapper): Promise<void> {
    await button(form(w), 'Save').trigger('click');
    await flushPromises();
}

describe('six levels at most (Q2)', () => {
    it('lets a sixth level be added, and never greys out Add a period', async () => {
        const { wrapper, server } = await mountEditor({ heat: levelsInUse(5) });
        await selectDay(wrapper, 'Monday');
        const add = () => button(wrapper, 'Add a period');
        await add().trigger('click');
        // Default 19° is free among 22, 20, 18, 16, 14: the form proposes it.
        expect(form(wrapper).get('[data-test="setpoint"]').text()).toBe('19°');
        await fillForm(wrapper, { start: '20:00', end: '21:00' });
        const mark = server.sent.length;
        await save(wrapper);
        expect(writes(server, mark)).toEqual(['set_state:H6S=19', 'set_timerange:H6']);
        expect(add().attributes('disabled')).toBeUndefined();
        expect(wrapper.findAll('button').some((b) => b.text().includes('Level'))).toBe(false);
        expect(text(wrapper)).not.toContain('Every level is in use');
    });

    it('refuses a seventh temperature from "Add a period", keeps the form open and writes nothing', async () => {
        const { wrapper, server } = await mountEditor({ heat: levelsInUse(6) });
        await addSlot(wrapper, { start: '20:00', end: '21:00', setpoint: 25 });
        const mark = server.sent.length;
        await save(wrapper);
        expect(form(wrapper).text()).toContain('6 different setpoints maximum');
        expect(button(form(wrapper), 'Save').attributes('disabled')).toBeDefined();
        await button(form(wrapper), 'Save').trigger('click');
        expect(form(wrapper).exists()).toBe(true);
        expect(writes(server, mark)).toEqual([]);
        expect(reads(server, mark)).toEqual([]);
        expect(banner(wrapper).exists()).toBe(false);
    });

    it('still accepts a slot at an existing temperature when the six levels are used', async () => {
        const { wrapper, server } = await mountEditor({ heat: levelsInUse(6) });
        await addSlot(wrapper, { start: '15:00', end: '16:00', setpoint: 20 });
        const mark = server.sent.length;
        await save(wrapper);
        expect(writes(server, mark)).toEqual(['set_timerange:H2']);
        expect(notice(wrapper).exists()).toBe(false);
        expect(form(wrapper).exists()).toBe(false);
    });

    it('counts the levels configured, not six, when the device has fewer', async () => {
        const ios = climateIos({ levels: 4, cool: false });
        const { wrapper, server } = await mountEditor({ ios, heat: levelsInUse(4) });
        
        await addSlot(wrapper, { start: '20:00', end: '21:00', setpoint: 25 });
        expect(form(wrapper).text()).toContain('4 different setpoints maximum');
        expect(button(form(wrapper), 'Save').attributes('disabled')).toBeDefined();
        expect(writes(server)).toEqual([]);
    });

    it('limits each direction on its own', async () => {
        const { wrapper } = await mountEditor({ heat: levelsInUse(6), cool: levelsInUse(2) });
        expect(wrapper.findAll('[role="tab"]').map((t) => t.text())).toEqual(['Heating', 'Cooling']);
        await openTab(wrapper, 'Cooling');
        await selectDay(wrapper, 'Monday');
        expect(button(wrapper, 'Add a period').attributes('disabled')).toBeUndefined();
    });

    it('creates no level when a day is copied, so the limit cannot be hit', async () => {
        const { wrapper, server } = await mountEditor({ heat: levelsInUse(6) });
        await selectDay(wrapper, 'Monday');
        await button(wrapper, 'Copy to…').trigger('click');
        const panel = wrapper.find('[role="dialog"]');
        await panel.find('button[aria-label="Tuesday"]').trigger('click');
        await panel.findAll('.sheet__actions button')[1].trigger('click');
        await flushPromises();
        expect(notice(wrapper).exists()).toBe(false);
        expect(writes(server).every((w) => w.startsWith('set_timerange:H'))).toBe(true);
        expect(writes(server)).toHaveLength(6);
    });
});

// ------------------------------------------------- cooling off (Q3) ---

describe('cooling "off" default', () => {
    const offBox = (w: VueWrapper) => w.find('.day__off input[type="checkbox"]');
    const value = (w: VueWrapper) => w.find('.day__value');
    const step = (w: VueWrapper, label: 'Lower' | 'Raise') => button(w.get('.day__stepper'), label === 'Lower' ? '−' : '+');

    it('is offered on the Cooling tab only, reflecting the server value', async () => {
        const { wrapper } = await mountEditor({ coolOff: true });
        await selectDay(wrapper, 'Monday');
        expect(offBox(wrapper).exists()).toBe(false);
        await openTab(wrapper, 'Cooling');
        await selectDay(wrapper, 'Monday');
        expect((offBox(wrapper).element as HTMLInputElement).checked).toBe(true);
    });

    it('hides the default setpoint and says "Off" outside slots while it is on', async () => {
        const { wrapper } = await mountEditor({ coolOff: true });
        await openTab(wrapper, 'Cooling');
        await selectDay(wrapper, 'Monday');
        expect(wrapper.find('.day__stepper').exists()).toBe(false);
        expect(text(wrapper)).toContain('Cooling stays off all day.');
        expect(wrapper.find('.track__gap').text()).toBe('');
    });

    it('shows the default setpoint while it is off', async () => {
        const { wrapper } = await mountEditor({ coolOff: false });
        await openTab(wrapper, 'Cooling');
        await selectDay(wrapper, 'Monday');
        expect(value(wrapper).text()).toBe('26°');
        expect(text(wrapper)).toContain('Cooling stays at 26° all day.');
    });

    it('writes only the switch when it is ticked, and swaps the stepper for "Off"', async () => {
        const { wrapper, server } = await mountEditor({ coolOff: false });
        await openTab(wrapper, 'Cooling');
        await selectDay(wrapper, 'Monday');
        const mark = server.sent.length;
        await offBox(wrapper).setValue(true);
        await flushPromises();
        expect(writes(server, mark)).toEqual(['set_state:CO=true']);
        expect(wrapper.find('.day__stepper').exists()).toBe(false);
        await offBox(wrapper).setValue(false);
        await flushPromises();
        expect(writes(server, mark)).toEqual(['set_state:CO=true', 'set_state:CO=false']);
        expect(wrapper.find('.day__stepper').exists()).toBe(true);
    });

    it('is not offered when the device has no cool_default_off IO', async () => {
        const ios = climateIos({ coolOff: false });
        delete ios.cool_default_off;
        const { wrapper } = await mountEditor({ ios });
        await openTab(wrapper, 'Cooling');
        await selectDay(wrapper, 'Monday');
        expect(offBox(wrapper).exists()).toBe(false);
        expect(wrapper.find('.day__stepper').exists()).toBe(true);
    });

    it('never offers an "off" for heating, which has a fixed default only', async () => {
        const { wrapper } = await mountEditor({ coolOff: true });
        await selectDay(wrapper, 'Monday');
        expect(offBox(wrapper).exists()).toBe(false);
        expect(value(wrapper).text()).toBe('19°');
        expect(text(wrapper)).toContain('Heating stays at 19° all day.');
        expect(wrapper.find('.track__gap').text()).toBe('');
    });

    it('fails the switch visibly, keeps the old value on screen and retries', async () => {
        const { wrapper, server } = await mountEditor({ coolOff: false });
        await openTab(wrapper, 'Cooling');
        await selectDay(wrapper, 'Monday');
        server.refuseValue = () => true;
        const mark = server.sent.length;
        await offBox(wrapper).setValue(true);
        await flushPromises();
        expect(banner(wrapper).text()).toContain('The server refused the change');
        expect(server.values.get('CO')).toBe('false');
        server.refuseValue = () => false;
        await button(banner(wrapper), 'Retry').trigger('click');
        await flushPromises();
        expect(writes(server, mark)).toEqual(['set_state:CO=true', 'set_state:CO=true']);
        expect(banner(wrapper).exists()).toBe(false);
        expect(server.values.get('CO')).toBe('true');
    });

    it('steps the default setpoint by half a degree and stops at 7 and 30', async () => {
        const { wrapper, server } = await mountEditor({ prepare: (srv) => { srv.values.set('HD', '29.5'); } });
        await selectDay(wrapper, 'Monday');
        await step(wrapper, 'Raise').trigger('click');
        await flushPromises();
        expect(value(wrapper).text()).toBe('30°');
        expect(step(wrapper, 'Raise').attributes('disabled')).toBeDefined();
        await step(wrapper, 'Lower').trigger('click');
        await flushPromises();
        expect(writes(server)).toEqual(['set_state:HD=30', 'set_state:HD=29.5']);
    });
});

// -------------------------------- auto (Q1) and disabled program (Q4) ---

describe('auto mode and a disabled program', () => {
    it('keeps the heating levels on H* and the cooling levels on C*, whatever the other set holds (Q1)', async () => {
        const { wrapper, server } = await mountEditor({ cool: { 1: [wireRange(2, 14, 0, 16, 0)] } });
        await addSlot(wrapper, { start: '06:00', end: '07:00', setpoint: 28 });
        const mark = server.sent.length;
        await save(wrapper);
        // 28° is above every cooling setpoint: the editor does not police the gap, the server does.
        expect(writes(server, mark)).toEqual(['set_state:H1S=28', 'set_timerange:H1']);
        await openTab(wrapper, 'Cooling');
        await selectDay(wrapper, 'Tuesday');
        await button(wrapper, 'Add a period').trigger('click');
        await fillForm(wrapper, { start: '20:00', end: '21:00', setpoint: 18 });
        const mark2 = server.sent.length;
        await save(wrapper);
        expect(writes(server, mark2)).toEqual(['set_state:C2S=18', 'set_timerange:C2']);
        expect(server.writesOf('H1')).toHaveLength(1);
        expect(server.writesOf('C1')).toEqual([]);
    });

    it('reads each direction from its own IOs and never writes while loading or switching tabs (Q4)', async () => {
        const { wrapper, server } = await mountEditor({ heat: { 1: [MON_8_10] } });
        await openTab(wrapper, 'Cooling');
        await openTab(wrapper, 'Heating');
        await selectDay(wrapper, 'Wednesday');
        expect(writes(server)).toEqual([]);
        expect(server.sent.filter((f) => f.msg !== 'get_state' && f.msg !== 'get_timerange')).toEqual([]);
    });

    it('leaves every setpoint alone when cooling goes off or a slot is deleted (Q4)', async () => {
        const { wrapper, server } = await mountEditor({ heat: { 1: [MON_8_10] }, coolOff: false });
        await openTab(wrapper, 'Cooling');
        await selectDay(wrapper, 'Monday');
        await wrapper.find('.day__off input[type="checkbox"]').setValue(true);
        await flushPromises();
        await openTab(wrapper, 'Heating');
        await selectDay(wrapper, 'Monday');
        await wrapper.find('button.day__row[aria-label^="Edit "]').trigger('click');
        await button(form(wrapper), 'Delete').trigger('click');
        await button(form(wrapper).get('[role="alertdialog"]'), 'Delete').trigger('click');
        await flushPromises();
        expect(writes(server)).toEqual(['set_state:CO=true', 'set_timerange:H1']);
        expect(server.writesOf('H1')).toEqual([[]]);
        expect(server.values.get('H1S')).toBe('22');
        expect(server.values.get('HD')).toBe('19');
    });
});

// ---------------------------------------------- partial write failures ---

describe('service session', () => {
    async function copyMondayToTuesday(wrapper: VueWrapper): Promise<void> {
        await selectDay(wrapper, 'Monday');
        await button(wrapper, 'Copy to…').trigger('click');
        const panel = wrapper.find('[role="dialog"]');
        await panel.find('button[aria-label="Tuesday"]').trigger('click');
        await panel.findAll('.sheet__actions button')[1].trigger('click');
        await flushPromises();
    }

    it('turns read-only with a message, and tells its parent, when the server answers scope denied', async () => {
        const { wrapper, server } = await mountEditor({
            heat: { 1: [MON_8_10] },
            prepare: (s) => (s.refuseRanges = () => 'scope denied'),
        });
        await copyMondayToTuesday(wrapper);
        expect(wrapper.emitted('denied')).toHaveLength(1);
        expect(banner(wrapper).exists()).toBe(false);
        expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
        expect(wrapper.find('[role="status"]').text()).toContain('Read-only: this session cannot change the program.');
        expect(text(wrapper)).toContain('Read-only: this session cannot change the program.');
        for (const row of wrapper.findAll('.day__row')) expect(row.attributes('disabled')).toBeDefined();
        for (const b of wrapper.findAll('.day__step')) expect(b.attributes('disabled')).toBeDefined();
        expect(button(wrapper, 'Copy to…').attributes('disabled')).toBeDefined();
        const mark = server.sent.length;
        await button(wrapper, 'Add a period').trigger('click');
        expect(button(wrapper, 'Add a period').attributes('disabled')).toBeDefined();
        expect(writes(server, mark)).toEqual([]);
    });

    it('shows the same message from the start when the parent already knows', async () => {
        const { wrapper } = await mountEditor({ readonly: true });
        expect(text(wrapper)).toContain('Read-only: this session cannot change the program.');
        expect(text(wrapper)).not.toContain('Read-only while offline.');
    });
});

describe('a write that fails half-way', () => {
    it('writes the setpoint, fails the ranges, reloads, shows the server truth and retries only the ranges', async () => {
        const { wrapper, server } = await mountEditor({
            heat: { 1: [MON_8_10] },
            prepare: (s) => (s.refuseRanges = (id, nth) => (id === 'H2' && nth === 1 ? 'config_not_written' : undefined)),
        });
        await addSlot(wrapper, { start: '12:00', end: '13:00', setpoint: 22.5 });
        const mark = server.sent.length;
        await save(wrapper);
        expect(writes(server, mark)).toEqual(['set_state:H2S=22.5', 'set_timerange:H2']);
        expect(banner(wrapper).text()).toContain('Not saved, try again');
        expect(form(wrapper).exists()).toBe(true);
        // The heating program is read again; the server holds the range in memory only.
        expect(reads(server, mark).sort()).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
        expect(server.ranges.get('H2')).toEqual([wireRange(1, 12, 0, 13, 0)]);

        const mark2 = server.sent.length;
        await button(banner(wrapper), 'Retry').trigger('click');
        await flushPromises();
        expect(writes(server, mark2)).toEqual(['set_timerange:H2']);
        expect(banner(wrapper).exists()).toBe(false);
        expect(server.ranges.get('H2')).toEqual([wireRange(1, 12, 0, 13, 0)]);
        expect(segments(wrapper)).toEqual(['08:00 – 10:00, 22°', '12:00 – 13:00, 22.5°']);
    });

    it('keeps both edits when another client changes the same level before Retry', async () => {
        const { wrapper, server } = await mountEditor({
            heat: { 1: [MON_8_10] },
            prepare: (s) => (s.refuseValue = (id) => id === 'H2S'),
        });
        await addSlot(wrapper, { start: '12:00', end: '13:00', setpoint: 22.5 });
        await save(wrapper);
        expect(banner(wrapper).text()).toContain('The server refused the change');

        server.refuseValue = () => false;
        server.ranges.set('H2', [wireRange(1, 15, 0, 16, 0)]);
        useScheduleStore().applyTimerangeChanged({ id: 'H2' });
        await flushPromises();

        await button(banner(wrapper), 'Retry').trigger('click');
        await flushPromises();
        // The level the slot first went to is now taken, so it is replayed on the next free one.
        expect(server.ranges.get('H2')).toEqual([wireRange(1, 15, 0, 16, 0)]);
        const held = ['H1', 'H2', 'H3'].flatMap((id) => server.ranges.get(id) ?? []);
        expect(held).toEqual(expect.arrayContaining([MON_8_10, wireRange(1, 12, 0, 13, 0), wireRange(1, 15, 0, 16, 0)]));
        expect(held).toHaveLength(3);
        expect(banner(wrapper).exists()).toBe(false);
    });

    it('replaces the banner by the notice when the retry finds every setpoint taken by another client', async () => {
        const { wrapper, server } = await mountEditor({
            heat: { 1: [MON_8_10] },
            prepare: (s) => (s.refuseValue = (id) => id === 'H2S'),
        });
        await addSlot(wrapper, { start: '12:00', end: '13:00', setpoint: 22.5 });
        await save(wrapper);
        expect(banner(wrapper).exists()).toBe(true);

        server.refuseValue = () => false;
        for (let n = 2; n <= 6; n++) {
            server.ranges.set(`H${String(n)}`, [wireRange(2, 15, 0, 16, 0)]);
            useScheduleStore().applyTimerangeChanged({ id: `H${String(n)}` });
            await flushPromises();
        }

        const mark = server.sent.length;
        await button(banner(wrapper), 'Retry').trigger('click');
        await flushPromises();
        expect(writes(server, mark)).toEqual([]);
        expect(banner(wrapper).exists()).toBe(false);
        expect(notice(wrapper).exists()).toBe(true);
    });

    it('retries on what another client changed meanwhile instead of erasing it', async () => {
        const { wrapper, server } = await mountEditor({
            heat: { 1: [MON_8_10] },
            prepare: (s) => (s.refuseValue = (id) => id === 'H2S'),
        });
        await addSlot(wrapper, { start: '12:00', end: '13:00', setpoint: 22.5 });
        await save(wrapper);
        expect(banner(wrapper).text()).toContain('The server refused the change');

        server.refuseValue = () => false;
        server.ranges.set('H3', [wireRange(1, 15, 0, 16, 0)]);
        useScheduleStore().applyTimerangeChanged({ id: 'H3' });
        await flushPromises();

        const mark = server.sent.length;
        await button(banner(wrapper), 'Retry').trigger('click');
        await flushPromises();
        expect(writes(server, mark)).toEqual(['set_state:H2S=22.5', 'set_timerange:H2']);
        expect(server.ranges.get('H3')).toEqual([wireRange(1, 15, 0, 16, 0)]);
    });

    it('stops at a refused setpoint: no range is written, and Retry writes both', async () => {
        const { wrapper, server } = await mountEditor({
            heat: { 1: [MON_8_10] },
            prepare: (s) => (s.refuseValue = (id) => id === 'H2S'),
        });
        await addSlot(wrapper, { start: '12:00', end: '13:00', setpoint: 22.5 });
        const mark = server.sent.length;
        await save(wrapper);
        expect(writes(server, mark)).toEqual(['set_state:H2S=22.5']);
        expect(banner(wrapper).text()).toContain('The server refused the change');
        expect(server.ranges.get('H2')).toEqual([]);

        server.refuseValue = () => false;
        const mark2 = server.sent.length;
        await button(banner(wrapper), 'Retry').trigger('click');
        await flushPromises();
        expect(writes(server, mark2)).toEqual(['set_state:H2S=22.5', 'set_timerange:H2']);
        expect(banner(wrapper).exists()).toBe(false);
    });

    it('stops at the first refused setpoint when a priority swap changes two of them', async () => {
        const { wrapper, server } = await mountEditor({
            heat: { 1: [MON_8_10], 2: [wireRange(1, 12, 0, 14, 0)] },
            prepare: (s) => (s.refuseValue = (id) => id === 'H1S'),
        });
        await selectDay(wrapper, 'Monday');
        await wrapper.findAll('button.day__row[aria-label^="Edit "]')[1].trigger('click');
        await fillForm(wrapper, { start: '09:00' });
        await button(form(wrapper).get('[data-test="overlap"]'), 'Swap').trigger('click');
        const mark = server.sent.length;
        await button(form(wrapper), 'Save').trigger('click');
        await flushPromises();
        expect(writes(server, mark)).toEqual(['set_state:H1S=20']);
        expect(banner(wrapper).text()).toContain('The server refused the change');
    });

    it('hatches the overlap on the preview track, over the shared hours only', async () => {
        const { wrapper } = await mountEditor({ heat: { 1: [MON_8_10], 2: [wireRange(1, 12, 0, 14, 0)] } });
        await selectDay(wrapper, 'Monday');
        await wrapper.findAll('button.day__row[aria-label^="Edit "]')[1].trigger('click');
        expect(form(wrapper).find('[data-test="track-overlap"]').exists()).toBe(false);
        await fillForm(wrapper, { start: '09:00' });
        const hatch = form(wrapper).get('[data-test="track-overlap"]');
        expect(hatch.attributes('style')).toContain('left: 37.5');
        expect(hatch.attributes('style')).toContain('width: 4.1666');
    });

    it('still writes the other levels when the server kept one change in memory only', async () => {
        const { wrapper, server } = await mountEditor({
            heat: { 1: [MON_8_10], 2: [wireRange(1, 12, 0, 14, 0)] },
            prepare: (s) => (s.refuseRanges = (id, nth) => (id === 'H1' && nth === 1 ? 'config_not_written' : undefined)),
        });
        await selectDay(wrapper, 'Monday');
        await button(wrapper, 'Copy to…').trigger('click');
        const panel = () => wrapper.find('[role="dialog"]');
        await panel().find('button[aria-label="Tuesday"]').trigger('click');
        const mark = server.sent.length;
        await panel().findAll('.sheet__actions button')[1].trigger('click');
        expect(wrapper.find('.sheet__confirm').exists()).toBe(false);
        await flushPromises();
        expect(writes(server, mark)).toEqual(['set_timerange:H1', 'set_timerange:H2']);
    });

    it('leaves the levels written before the failure, then retries only the missing one', async () => {
        const { wrapper, server } = await mountEditor({
            heat: { 1: [MON_8_10], 2: [wireRange(1, 12, 0, 14, 0)] },
            prepare: (s) => (s.refuseRanges = (id, nth) => (id === 'H2' && nth === 1 ? 'config_not_written' : undefined)),
        });
        await selectDay(wrapper, 'Monday');
        await button(wrapper, 'Copy to…').trigger('click');
        const panel = () => wrapper.find('[role="dialog"]');
        await panel().find('button[aria-label="Tuesday"]').trigger('click');
        const mark = server.sent.length;
        await panel().findAll('.sheet__actions button')[1].trigger('click');
        expect(wrapper.find('.sheet__confirm').exists()).toBe(false);
        await flushPromises();
        expect(writes(server, mark)).toEqual(['set_timerange:H1', 'set_timerange:H2']);
        expect(banner(wrapper).text()).toContain('Copy incomplete: not saved, try again');
        expect(server.ranges.get('H1')).toHaveLength(2);
        expect(server.ranges.get('H2')).toHaveLength(2);
        expect(panel().exists()).toBe(true);

        const mark2 = server.sent.length;
        await button(banner(wrapper), 'Retry').trigger('click');
        await flushPromises();
        expect(writes(server, mark2)).toEqual(['set_timerange:H2']);
        expect(server.ranges.get('H2')).toHaveLength(2);
        expect(banner(wrapper).exists()).toBe(false);
    });

    it('keeps the most serious error when a later level is refused after a not-written one', async () => {
        const { wrapper, server } = await mountEditor({
            heat: { 1: [MON_8_10], 2: [wireRange(1, 12, 0, 14, 0)] },
            prepare: (s) => (s.refuseRanges = (id) => (id === 'H1' ? 'config_not_written' : id === 'H2' ? 'wrong input' : undefined)),
        });
        await selectDay(wrapper, 'Monday');
        await wrapper.findAll('button.day__row[aria-label^="Edit "]')[1].trigger('click');
        await fillForm(wrapper, { start: '09:00' });
        await button(form(wrapper).get('[data-test="overlap"]'), 'Swap').trigger('click');
        const mark = server.sent.length;
        await button(form(wrapper), 'Save').trigger('click');
        await flushPromises();
        expect(writes(server, mark)).toContain('set_timerange:H2');
        expect(banner(wrapper).text()).toContain('The server refused the change');
    });

    it('closes the form once a retried save has succeeded', async () => {
        const { wrapper } = await mountEditor({
            heat: { 1: [MON_8_10] },
            prepare: (s) => (s.refuseRanges = (id, nth) => (id === 'H2' && nth === 1 ? 'config_not_written' : undefined)),
        });
        await addSlot(wrapper, { start: '12:00', end: '13:00', setpoint: 22.5 });
        await save(wrapper);
        await button(banner(wrapper), 'Retry').trigger('click');
        await flushPromises();
        expect(banner(wrapper).exists()).toBe(false);
        expect(form(wrapper).exists()).toBe(false);
    });

    it('turns a lost answer into a timeout banner once the reply window has elapsed', async () => {
        const { wrapper, server } = await mountEditor({ heat: { 1: [MON_8_10] } });
        await addSlot(wrapper, { start: '12:00', end: '13:00', setpoint: 22 });
        server.silent.add('H1');
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const mark = server.sent.length;
        await button(form(wrapper), 'Save').trigger('click');
        await vi.advanceTimersByTimeAsync(8000);
        await flushPromises();
        expect(writes(server, mark)).toEqual(['set_timerange:H1']);
        expect(banner(wrapper).text()).toContain('No answer from the server, try again');
    });
});

// ------------------------------------------------------------- months ---

// The contract says a write omits `months`: the server keeps the mask it holds.
describe('months with a range write', () => {
    it('omits months, whatever the server reported on read', async () => {
        const { wrapper, server } = await mountEditor({
            heat: { 1: [MON_8_10] },
            prepare: (s) => s.months.set('H1', '000011110000'),
        });
        await selectDay(wrapper, 'Monday');
        await wrapper.find('button.day__row[aria-label^="Edit "]').trigger('click');
        await fillForm(wrapper, { end: '11:00' });
        await save(wrapper);
        const frames = setTimeranges(server);
        expect(frames).toHaveLength(1);
        expect(frames[0].data).not.toHaveProperty('months');
    });
});

// -------------------------------------------------------- copy a day (Q4) ---

describe('copy a day (Q4)', () => {
    const TUE_6_7 = wireRange(2, 6, 0, 7, 0);
    const panel = (w: VueWrapper) => w.find('[role="dialog"]');
    const dialog = (w: VueWrapper) => w.find('.sheet__confirm');
    const day = (w: VueWrapper, name: string) => panel(w).get(`button[aria-label^="${name}"]`);
    const submit = (w: VueWrapper) => panel(w).findAll('.sheet__actions button')[1];

    async function openCopy(w: VueWrapper, name = 'Monday'): Promise<void> {
        await selectDay(w, name);
        await button(w, 'Copy to…').trigger('click');
    }

    const days = (ranges: WireRange[] | undefined) => (ranges ?? []).map((r) => r.day);

    it('copies at once, without asking, when no target holds a slot', async () => {
        const { wrapper, server } = await mountEditor({ heat: { 1: [MON_8_10] } });
        await openCopy(wrapper);
        await day(wrapper, 'Tuesday').trigger('click');
        const mark = server.sent.length;
        await submit(wrapper).trigger('click');
        await flushPromises();
        expect(dialog(wrapper).exists()).toBe(false);
        expect(writes(server, mark)).toEqual(['set_timerange:H1']);
        expect(days(server.ranges.get('H1'))).toEqual(['1', '2']);
        expect(panel(wrapper).exists()).toBe(false);
    });

    it('asks first when a target holds slots, names only those days, and writes nothing until confirmed', async () => {
        const { wrapper, server } = await mountEditor({ heat: { 1: [MON_8_10], 2: [TUE_6_7] } });
        await openCopy(wrapper);
        for (const d of ['Tuesday', 'Wednesday']) await day(wrapper, d).trigger('click');
        const mark = server.sent.length;
        await submit(wrapper).trigger('click');
        await flushPromises();
        expect(dialog(wrapper).exists()).toBe(true);
        expect(dialog(wrapper).text()).toContain('Tuesday (1 period)');
        expect(dialog(wrapper).text()).not.toContain('Wednesday');
        expect(writes(server, mark)).toEqual([]);

        await submit(wrapper).trigger('click');
        await flushPromises();
        expect(writes(server, mark)).toEqual(['set_timerange:H1', 'set_timerange:H2']);
        // Tuesday's own 06:00-07:00 slot is overwritten, by the Monday one at the same level.
        expect(days(server.ranges.get('H1'))).toEqual(['1', '2', '3']);
        expect(server.ranges.get('H2')).toEqual([]);
        expect(panel(wrapper).exists()).toBe(false);
    });

    it('cancelling the confirmation writes nothing and keeps the sheet and its targets', async () => {
        const { wrapper, server } = await mountEditor({ heat: { 1: [MON_8_10], 2: [TUE_6_7] } });
        await openCopy(wrapper);
        await day(wrapper, 'Tuesday').trigger('click');
        await submit(wrapper).trigger('click');
        const mark = server.sent.length;
        await panel(wrapper).findAll('.sheet__actions button')[0].trigger('click');
        await flushPromises();
        expect(dialog(wrapper).exists()).toBe(false);
        expect(panel(wrapper).exists()).toBe(true);
        expect(day(wrapper, 'Tuesday').attributes('aria-pressed')).toBe('true');
        expect(writes(server, mark)).toEqual([]);
        expect(server.ranges.get('H2')).toEqual([TUE_6_7]);
    });

    it('works on the active tab only: heating slots of the target day are replaced, cooling ones are left alone', async () => {
        const { wrapper, server } = await mountEditor({
            heat: { 1: [MON_8_10], 2: [TUE_6_7] },
            cool: { 1: [wireRange(2, 14, 0, 16, 0)] },
        });
        await openCopy(wrapper);
        await day(wrapper, 'Tuesday').trigger('click');
        await submit(wrapper).trigger('click');
        await submit(wrapper).trigger('click');
        await flushPromises();
        expect(writes(server).every((w) => w.startsWith('set_timerange:H'))).toBe(true);
        expect(server.writesOf('C1')).toEqual([]);
        expect(server.ranges.get('C1')).toEqual([wireRange(2, 14, 0, 16, 0)]);
        await openTab(wrapper, 'Cooling');
        await selectDay(wrapper, 'Wednesday');
        expect(button(wrapper, 'Copy to…').attributes('disabled')).toBeDefined();
        expect(panel(wrapper).exists()).toBe(false);
    });

    it('copies the other direction on its own tab and never touches heating', async () => {
        const { wrapper, server } = await mountEditor({ heat: { 1: [MON_8_10] }, cool: { 1: [wireRange(2, 14, 0, 16, 0)] } });
        await openTab(wrapper, 'Cooling');
        await openCopy(wrapper, 'Tuesday');
        await day(wrapper, 'Thursday').trigger('click');
        await submit(wrapper).trigger('click');
        await flushPromises();
        expect(dialog(wrapper).exists()).toBe(false);
        expect(writes(server)).toEqual(['set_timerange:C1']);
        expect(days(server.ranges.get('C1'))).toEqual(['2', '4']);
    });

    it('keeps Copy to… disabled on a day with no slot, writing nothing', async () => {
        const { wrapper, server } = await mountEditor({ heat: { 1: [MON_8_10] } });
        const mark = server.sent.length;
        await selectDay(wrapper, 'Friday');
        expect(button(wrapper, 'Copy to…').attributes('disabled')).toBeDefined();
        expect(panel(wrapper).exists()).toBe(false);
        expect(writes(server, mark)).toEqual([]);
    });

    it('greys the source day and marks it, and disables the button until a target is picked', async () => {
        const { wrapper } = await mountEditor({ heat: { 1: [MON_8_10] } });
        await openCopy(wrapper);
        expect(submit(wrapper).attributes('disabled')).toBeDefined();
        expect(submit(wrapper).text()).toBe('Copy to 0 days');
        expect(day(wrapper, 'Monday').attributes('disabled')).toBeDefined();
        expect(day(wrapper, 'Monday').attributes('aria-label')).toBe('Monday, source');
        expect(panel(wrapper).text()).toContain('Replaces the existing periods of these days');
        await day(wrapper, 'Tuesday').trigger('click');
        expect(submit(wrapper).attributes('disabled')).toBeUndefined();
        expect(submit(wrapper).text()).toBe('Copy to 1 day');
    });

    it('the Workdays chip targets Tuesday to Friday from a Monday source, Weekend both weekend days, All the six others', async () => {
        const { wrapper, server } = await mountEditor({ heat: { 1: [MON_8_10] } });
        await openCopy(wrapper);
        const pressed = () =>
            panel(wrapper)
                .findAll('.sheet__days button')
                .filter((b) => b.attributes('aria-pressed') === 'true')
                .map((b) => b.attributes('aria-label'));
        await button(panel(wrapper), 'Workdays').trigger('click');
        expect(pressed()).toEqual(['Tuesday', 'Wednesday', 'Thursday', 'Friday']);
        await button(panel(wrapper), 'All').trigger('click');
        expect(pressed()).toHaveLength(6);
        await button(panel(wrapper), 'Weekend').trigger('click');
        expect(pressed()).toEqual(['Saturday', 'Sunday']);
        await submit(wrapper).trigger('click');
        await flushPromises();
        expect(days(server.ranges.get('H1'))).toEqual(['1', '6', '7']);
    });

    it('closes on Cancel and on Escape without leaving the day', async () => {
        const { wrapper } = await mountEditor({ heat: { 1: [MON_8_10] } });
        await openCopy(wrapper);
        await panel(wrapper).findAll('.sheet__actions button')[0].trigger('click');
        expect(panel(wrapper).exists()).toBe(false);
        expect(wrapper.find('.day').exists()).toBe(true);
        await button(wrapper, 'Copy to…').trigger('click');
        await panel(wrapper).trigger('keydown', { key: 'Escape' });
        expect(panel(wrapper).exists()).toBe(false);
        expect(wrapper.find('.day').exists()).toBe(true);
    });

    it('cannot be opened when read-only', async () => {
        const { wrapper, server } = await mountEditor({ heat: { 1: [MON_8_10] }, readonly: true });
        await selectDay(wrapper, 'Monday');
        expect(button(wrapper, 'Copy to…').attributes('disabled')).toBeDefined();
        await button(wrapper, 'Copy to…').trigger('click');
        expect(panel(wrapper).exists()).toBe(false);
        expect(writes(server)).toEqual([]);
    });
});

describe('a re-read that overlaps a write', () => {
    it('drops the stale answer and reads again, so the screen shows what the write left', async () => {
        const { wrapper, server } = await mountEditor({ heat: { 1: [MON_8_10] } });
        server.ranges.set('H1', [wireRange(1, 6, 0, 7, 0)]);
        server.held.add('H1');
        useScheduleStore().applyTimerangeChanged({ id: 'H1' });
        await flushPromises();

        // Same setpoint as level 1: the slot joins level 1 and H1 is written while its re-read waits.
        await addSlot(wrapper, { start: '12:00', end: '13:00', setpoint: 22 });
        await save(wrapper);
        expect(server.ranges.get('H1')).toEqual([wireRange(1, 8, 0, 10, 0), wireRange(1, 12, 0, 13, 0)]);

        const mark = server.sent.length;
        server.release();
        await flushPromises();
        expect(reads(server, mark)).toEqual(['H1']);
        expect(segments(wrapper)).toEqual(['08:00 – 10:00, 22°', '12:00 – 13:00, 22°']);
    });
});
