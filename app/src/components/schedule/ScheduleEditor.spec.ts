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
    mode?: 'multi' | 'simple';
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
        props: { io, mode: opts.mode ?? 'multi', readonly: opts.readonly ?? false },
        global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] },
    });
    await flushPromises();
    return { wrapper, server };
}

// ------------------------------------------------------------- helpers ---

const text = (w: VueWrapper) => w.text().replace(/\s+/g, ' ');

type Root = { findAll(selector: string): DOMWrapper<Element>[] };

function button(root: Root, label: string) {
    const found = root.findAll('button').find((b) => b.text() === label);
    if (!found) throw new Error(`no button "${label}"`);
    return found;
}

async function selectDay(w: VueWrapper, name: string): Promise<void> {
    await w.find(`.schedule__days[role="tablist"] button[aria-label="${name}"]`).trigger('click');
}

async function openTab(w: VueWrapper, label: string): Promise<void> {
    await button(w, label).trigger('click');
    await flushPromises();
}

const segments = (w: VueWrapper) => w.findAll('button.track__seg').map((b) => b.attributes('aria-label'));

function form(w: VueWrapper) {
    return w.find('section[aria-labelledby="schedule-form-title"]');
}

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

async function fillForm(w: VueWrapper, v: { start?: string; end?: string; setpoint?: number; days?: string[] }): Promise<void> {
    const f = form(w);
    const times = f.findAll('input[type="time"]');
    if (v.start !== undefined) await times[0].setValue(v.start);
    if (v.end !== undefined) await times[1].setValue(v.end);
    if (v.setpoint !== undefined) await f.find('input[type="number"]').setValue(v.setpoint);
    for (const day of v.days ?? []) await f.find(`button[aria-label="${day}"]`).trigger('click');
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

    it('counts the levels in use on each tab and in the level counter', async () => {
        const { wrapper } = await mountEditor({
            heat: { 1: [MON_8_10], 2: [wireRange(1, 12, 0, 14, 0)] },
            cool: { 1: [wireRange(2, 14, 0, 16, 0)] },
        });
        const tabs = wrapper.findAll('[role="tab"].schedule__tab').map((t) => t.text());
        expect(tabs).toEqual(['Heating (2)', 'Cooling (1)']);
        expect(text(wrapper)).toContain('Levels: 2 of 6');
        await openTab(wrapper, 'Cooling (1)');
        expect(text(wrapper)).toContain('Levels: 1 of 6');
    });

    it('ignores a seventh level and reads only the IOs it was given', async () => {
        const ios = { ...climateIos({ cool: false }), heat_level7: 'H7', heat_level7_setpoint: 'H7S' };
        const { wrapper, server } = await mountEditor({ ios });
        expect(reads(server)).not.toContain('H7');
        expect(wrapper.find('.schedule__tabs').exists()).toBe(false);
        expect(text(wrapper)).toContain('Levels: 0 of 6');
    });

    it('shows the level of a slot on the track with its setpoint', async () => {
        const { wrapper } = await mountEditor({ heat: { 2: [MON_8_10] } });
        await selectDay(wrapper, 'Monday');
        expect(segments(wrapper)).toEqual(['Level 2, 08:00 to 10:00, 20°']);
    });

    it('lets level 1 win over a lower priority slot that overlaps it', async () => {
        const { wrapper } = await mountEditor({
            heat: { 1: [wireRange(1, 8, 0, 12, 0)], 2: [wireRange(1, 10, 0, 14, 0)] },
        });
        await selectDay(wrapper, 'Monday');
        expect(segments(wrapper)).toEqual(['Level 1, 08:00 to 12:00, 22°', 'Level 2, 12:00 to 14:00, 20°']);
    });

    it('counts a sunrise range as a used level and gives a new setpoint the next one', async () => {
        const sunrise: WireRange = { ...wireRange(1, 0, 0, 0, 0), start_type: '1', start_offset: '30', end_hour: '9' };
        const { wrapper, server } = await mountEditor({ heat: { 1: [sunrise] } });
        expect(text(wrapper)).toContain('Levels: 1 of 6');
        await selectDay(wrapper, 'Monday');
        await button(wrapper, '+ Slot').trigger('click');
        // 22.5 is not level 1's setpoint: the kept range makes level 1 busy, so the slot takes level 2.
        await fillForm(wrapper, { setpoint: 22.5 });
        const mark = server.sent.length;
        await button(form(wrapper), 'Save').trigger('click');
        await flushPromises();
        expect(writes(server, mark)).toEqual(['set_state:H2S=22.5', 'set_timerange:H2']);
        expect(server.writesOf('H1')).toEqual([]);
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

/** Monday 2026-11-16, 12:00: the day a fresh form is pre-selected on. */
function mondayNoon(): void {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 16, 12, 0));
}

async function addSlot(w: VueWrapper, v: Parameters<typeof fillForm>[1]): Promise<void> {
    await selectDay(w, 'Monday');
    await button(w, '+ Slot').trigger('click');
    await fillForm(w, v);
}

async function save(w: VueWrapper): Promise<void> {
    await button(form(w), 'Save').trigger('click');
    await flushPromises();
}

// ---------------------------------------------------------- simple mode ---

describe('simple mode', () => {
    it('opens the form at once, with the default setpoint and no timeline', async () => {
        mondayNoon();
        const { wrapper, server } = await mountEditor({ mode: 'simple' });
        expect(form(wrapper).exists()).toBe(true);
        expect(wrapper.find('button.track__seg').exists()).toBe(false);
        expect(wrapper.findAll('button').some((b) => b.text() === '+ Slot')).toBe(false);
        expect(writes(server)).toEqual([]);
    });

    it('proposes the default setpoint it reads, as the multi-level form does', async () => {
        const { wrapper } = await mountEditor({ mode: 'simple' });
        expect((form(wrapper).find('input[type="number"]').element as HTMLInputElement).value).toBe('19');
    });

    it('applies one entry to the first free level and says which one', async () => {
        mondayNoon();
        const { wrapper, server } = await mountEditor({ mode: 'simple' });
        await fillForm(wrapper, { start: '06:00', end: '07:30', setpoint: 21 });
        const mark = server.sent.length;
        await button(form(wrapper), 'Apply').trigger('click');
        await flushPromises();
        expect(writes(server, mark)).toEqual(['set_state:H1S=21', 'set_timerange:H1']);
        expect(server.writesOf('H1')).toEqual([[wireRange(1, 6, 0, 7, 30)]]);
        expect(text(wrapper)).toContain('Applied to level 1.');
    });

    it('appends a second entry at the same temperature to the same level, without rewriting the setpoint', async () => {
        mondayNoon();
        const { wrapper, server } = await mountEditor({ mode: 'simple' });
        await fillForm(wrapper, { start: '06:00', end: '07:00', setpoint: 21 });
        await button(form(wrapper), 'Apply').trigger('click');
        await flushPromises();
        await fillForm(wrapper, { start: '18:00', end: '19:00', setpoint: 21 });
        const mark = server.sent.length;
        await button(form(wrapper), 'Apply').trigger('click');
        await flushPromises();
        expect(writes(server, mark)).toEqual(['set_timerange:H1']);
        expect(server.ranges.get('H1')).toEqual([wireRange(1, 6, 0, 7, 0), wireRange(1, 18, 0, 19, 0)]);
    });

    it('sends another temperature to the next level', async () => {
        mondayNoon();
        const { wrapper, server } = await mountEditor({ mode: 'simple', heat: { 1: [MON_8_10] } });
        await fillForm(wrapper, { start: '12:00', end: '13:00', setpoint: 23 });
        const mark = server.sent.length;
        await button(form(wrapper), 'Apply').trigger('click');
        await flushPromises();
        expect(writes(server, mark)).toEqual(['set_state:H2S=23', 'set_timerange:H2']);
        expect(text(wrapper)).toContain('Applied to level 2.');
    });

    it('refuses a seventh temperature and writes nothing', async () => {
        mondayNoon();
        const { wrapper, server } = await mountEditor({ mode: 'simple', heat: levelsInUse(6) });
        await fillForm(wrapper, { start: '20:00', end: '21:00', setpoint: 25 });
        const mark = server.sent.length;
        await button(form(wrapper), 'Apply').trigger('click');
        await flushPromises();
        expect(notice(wrapper).text()).toBe('6 levels maximum for Heating');
        expect(writes(server, mark)).toEqual([]);
        expect(text(wrapper)).not.toContain('Applied to level');
    });

    it('refuses an empty range or no day without writing', async () => {
        mondayNoon();
        const { wrapper, server } = await mountEditor({ mode: 'simple' });
        await fillForm(wrapper, { start: '09:00', end: '09:00' });
        await button(form(wrapper), 'Apply').trigger('click');
        await flushPromises();
        expect(notice(wrapper).text()).toBe('The end must follow the start');
        await form(wrapper).find('button[aria-label="Monday"]').trigger('click');
        await fillForm(wrapper, { end: '10:00' });
        await button(form(wrapper), 'Apply').trigger('click');
        await flushPromises();
        expect(notice(wrapper).text()).toBe('The end must follow the start');
        expect(writes(server)).toEqual([]);
    });

    it('writes nothing and disables Apply when read-only', async () => {
        const { wrapper, server } = await mountEditor({ mode: 'simple', readonly: true });
        expect(button(form(wrapper), 'Apply').attributes('disabled')).toBeDefined();
        await button(form(wrapper), 'Apply').trigger('click');
        await flushPromises();
        expect(writes(server)).toEqual([]);
    });

    it('applies on the cooling levels of a device that only cools', async () => {
        mondayNoon();
        const { wrapper, server } = await mountEditor({ mode: 'simple', ios: climateIos({ heat: false }) });
        await fillForm(wrapper, { start: '13:00', end: '17:00', setpoint: 26 });
        const mark = server.sent.length;
        await button(form(wrapper), 'Apply').trigger('click');
        await flushPromises();
        expect(writes(server, mark)).toEqual(['set_state:C1S=26', 'set_timerange:C1']);
    });

    it('keeps the form when the other direction is chosen', async () => {
        const { wrapper } = await mountEditor({ mode: 'simple' });
        await openTab(wrapper, 'Cooling (0)');
        expect(form(wrapper).exists()).toBe(true);
    });
});

// -------------------------------------------------- level limit (Q2) ---

describe('six levels at most (Q2)', () => {
    it('lets a sixth level be added, and never greys out + Slot', async () => {
        const { wrapper, server } = await mountEditor({ heat: levelsInUse(5) });
        const add = () => button(wrapper, '+ Slot');
        expect(text(wrapper)).toContain('Levels: 5 of 6');
        await add().trigger('click');
        // Default 19° is free among 22, 20, 18, 16, 14: the form proposes it.
        expect((form(wrapper).find('input[type="number"]').element as HTMLInputElement).value).toBe('19');
        await fillForm(wrapper, { start: '20:00', end: '21:00' });
        const mark = server.sent.length;
        await save(wrapper);
        expect(writes(server, mark)).toEqual(['set_state:H6S=19', 'set_timerange:H6']);
        expect(text(wrapper)).toContain('Levels: 6 of 6');
        expect(add().attributes('disabled')).toBeUndefined();
        expect(wrapper.findAll('button').some((b) => b.text().includes('Level'))).toBe(false);
        expect(text(wrapper)).not.toContain('Every level is in use');
    });

    it('refuses a seventh temperature from "+ Slot", keeps the form open and writes nothing', async () => {
        const { wrapper, server } = await mountEditor({ heat: levelsInUse(6) });
        await addSlot(wrapper, { start: '20:00', end: '21:00', setpoint: 25 });
        const mark = server.sent.length;
        await save(wrapper);
        expect(notice(wrapper).text()).toBe('6 levels maximum for Heating');
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
        expect(text(wrapper)).toContain('Levels: 4 of 4');
        await addSlot(wrapper, { start: '20:00', end: '21:00', setpoint: 25 });
        await save(wrapper);
        expect(notice(wrapper).text()).toBe('4 levels maximum for Heating');
        expect(writes(server)).toEqual([]);
    });

    it('limits each direction on its own', async () => {
        const { wrapper } = await mountEditor({ heat: levelsInUse(6), cool: levelsInUse(2) });
        expect(wrapper.findAll('[role="tab"].schedule__tab').map((t) => t.text())).toEqual(['Heating (6)', 'Cooling (2)']);
        await openTab(wrapper, 'Cooling (2)');
        expect(text(wrapper)).toContain('Levels: 2 of 6');
        expect(button(wrapper, '+ Slot').attributes('disabled')).toBeUndefined();
    });

    it('creates no level when a day is copied, so the limit cannot be hit', async () => {
        const { wrapper, server } = await mountEditor({ heat: levelsInUse(6) });
        await selectDay(wrapper, 'Monday');
        await button(wrapper, 'Copy this day…').trigger('click');
        const panel = wrapper.find('section.schedule__panel');
        await panel.find('button[aria-label="Tuesday"]').trigger('click');
        await button(panel, 'Copy').trigger('click');
        await flushPromises();
        expect(notice(wrapper).exists()).toBe(false);
        expect(writes(server).every((w) => w.startsWith('set_timerange:H'))).toBe(true);
        expect(writes(server)).toHaveLength(6);
    });
});

// ------------------------------------------------- cooling off (Q3) ---

describe('cooling "off" default', () => {
    it('is offered on the Cooling tab only, reflecting the server value', async () => {
        const { wrapper } = await mountEditor({ coolOff: true });
        expect(wrapper.find('.schedule__defaults input[type="checkbox"]').exists()).toBe(false);
        await openTab(wrapper, 'Cooling (0)');
        const box = wrapper.find('.schedule__defaults input[type="checkbox"]');
        expect((box.element as HTMLInputElement).checked).toBe(true);
    });

    it('hides the default setpoint and says "Off" outside slots while it is on', async () => {
        const { wrapper } = await mountEditor({ coolOff: true });
        await openTab(wrapper, 'Cooling (0)');
        expect(wrapper.find('.schedule__defaults input[type="number"]').exists()).toBe(false);
        expect(text(wrapper)).toContain('No cooling slot. Off outside slots.');
        expect(wrapper.find('.track__gap').text()).toBe('Off');
    });

    it('shows the default setpoint while it is off', async () => {
        const { wrapper } = await mountEditor({ coolOff: false });
        await openTab(wrapper, 'Cooling (0)');
        const input = wrapper.find('.schedule__defaults input[type="number"]');
        expect((input.element as HTMLInputElement).value).toBe('26');
        expect(text(wrapper)).toContain('No cooling slot. Default: 26°.');
    });

    it('writes only the switch when it is ticked, and swaps the setpoint field for "Off"', async () => {
        const { wrapper, server } = await mountEditor({ coolOff: false });
        await openTab(wrapper, 'Cooling (0)');
        const mark = server.sent.length;
        await wrapper.find('.schedule__defaults input[type="checkbox"]').setValue(true);
        await flushPromises();
        expect(writes(server, mark)).toEqual(['set_state:CO=true']);
        expect(wrapper.find('.schedule__defaults input[type="number"]').exists()).toBe(false);
        await wrapper.find('.schedule__defaults input[type="checkbox"]').setValue(false);
        await flushPromises();
        expect(writes(server, mark)).toEqual(['set_state:CO=true', 'set_state:CO=false']);
        expect(wrapper.find('.schedule__defaults input[type="number"]').exists()).toBe(true);
    });

    it('is not offered when the device has no cool_default_off IO', async () => {
        const ios = climateIos({ coolOff: false });
        const { wrapper } = await mountEditor({ ios });
        await openTab(wrapper, 'Cooling (0)');
        expect(wrapper.find('.schedule__defaults input[type="checkbox"]').exists()).toBe(false);
        expect(wrapper.find('.schedule__defaults input[type="number"]').exists()).toBe(true);
    });

    it('never offers an "off" for heating, which has a fixed default only', async () => {
        const { wrapper } = await mountEditor({ coolOff: true });
        expect(wrapper.find('.schedule__defaults input[type="checkbox"]').exists()).toBe(false);
        expect((wrapper.find('.schedule__defaults input[type="number"]').element as HTMLInputElement).value).toBe('19');
        expect(text(wrapper)).toContain('No heating slot. Default: 19°.');
        expect(wrapper.find('.track__gap').text()).toContain('19');
        expect(wrapper.find('.track__gap').text()).not.toContain('Off');
    });

    it('fails the switch visibly, keeps the old value on screen and retries', async () => {
        const { wrapper, server } = await mountEditor({ coolOff: false });
        await openTab(wrapper, 'Cooling (0)');
        server.refuseValue = () => true;
        const mark = server.sent.length;
        await wrapper.find('.schedule__defaults input[type="checkbox"]').setValue(true);
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

    it('writes a default setpoint inside 7 to 30 and ignores one outside', async () => {
        const { wrapper, server } = await mountEditor();
        const input = () => wrapper.find('.schedule__defaults input[type="number"]');
        // The field is disabled while a write is in flight: let each one finish.
        for (const v of ['21.5', '6.5', '30.5', '', '30', '7']) {
            await input().setValue(v);
            await flushPromises();
        }
        expect(writes(server)).toEqual(['set_state:HD=21.5', 'set_state:HD=30', 'set_state:HD=7']);
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
        await openTab(wrapper, 'Cooling (1)');
        await selectDay(wrapper, 'Tuesday');
        await button(wrapper, '+ Slot').trigger('click');
        await fillForm(wrapper, { start: '20:00', end: '21:00', setpoint: 18 });
        const mark2 = server.sent.length;
        await save(wrapper);
        expect(writes(server, mark2)).toEqual(['set_state:C2S=18', 'set_timerange:C2']);
        expect(server.writesOf('H1')).toHaveLength(1);
        expect(server.writesOf('C1')).toEqual([]);
    });

    it('reads each direction from its own IOs and never writes while loading or switching tabs (Q4)', async () => {
        const { wrapper, server } = await mountEditor({ heat: { 1: [MON_8_10] } });
        await openTab(wrapper, 'Cooling (0)');
        await openTab(wrapper, 'Heating (1)');
        await selectDay(wrapper, 'Wednesday');
        expect(writes(server)).toEqual([]);
        expect(server.sent.filter((f) => f.msg !== 'get_state' && f.msg !== 'get_timerange')).toEqual([]);
    });

    it('leaves every setpoint alone when cooling goes off or a slot is deleted (Q4)', async () => {
        const { wrapper, server } = await mountEditor({ heat: { 1: [MON_8_10] }, coolOff: false });
        await openTab(wrapper, 'Cooling (0)');
        await wrapper.find('.schedule__defaults input[type="checkbox"]').setValue(true);
        await flushPromises();
        await openTab(wrapper, 'Heating (1)');
        await selectDay(wrapper, 'Monday');
        await wrapper.find('button.track__seg').trigger('click');
        await button(form(wrapper), 'Delete').trigger('click');
        await flushPromises();
        expect(writes(server)).toEqual(['set_state:CO=true', 'set_timerange:H1']);
        expect(server.writesOf('H1')).toEqual([[]]);
        expect(server.values.get('H1S')).toBe('22');
        expect(server.values.get('HD')).toBe('19');
    });
});

// ---------------------------------------------- partial write failures ---

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
        expect(segments(wrapper)).toEqual(['Level 1, 08:00 to 10:00, 22°', 'Level 2, 12:00 to 13:00, 22.5°']);
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
        await wrapper.findAll('button.track__seg')[1].trigger('click');
        const mark = server.sent.length;
        await button(form(wrapper), 'Raise priority').trigger('click');
        await flushPromises();
        expect(writes(server, mark)).toEqual(['set_state:H1S=20']);
        expect(banner(wrapper).text()).toContain('The server refused the change');
    });

    it('still writes the other levels when the server kept one change in memory only', async () => {
        const { wrapper, server } = await mountEditor({
            heat: { 1: [MON_8_10], 2: [wireRange(1, 12, 0, 14, 0)] },
            prepare: (s) => (s.refuseRanges = (id, nth) => (id === 'H1' && nth === 1 ? 'config_not_written' : undefined)),
        });
        await selectDay(wrapper, 'Monday');
        await button(wrapper, 'Copy this day…').trigger('click');
        const panel = () => wrapper.find('section.schedule__panel');
        await panel().find('button[aria-label="Tuesday"]').trigger('click');
        const mark = server.sent.length;
        await button(panel(), 'Copy').trigger('click');
        await flushPromises();
        expect(writes(server, mark)).toEqual(['set_timerange:H1', 'set_timerange:H2']);
    });

    it('leaves the levels written before the failure, then retries only the missing one', async () => {
        const { wrapper, server } = await mountEditor({
            heat: { 1: [MON_8_10], 2: [wireRange(1, 12, 0, 14, 0)] },
            prepare: (s) => (s.refuseRanges = (id, nth) => (id === 'H2' && nth === 1 ? 'config_not_written' : undefined)),
        });
        await selectDay(wrapper, 'Monday');
        await button(wrapper, 'Copy this day…').trigger('click');
        const panel = () => wrapper.find('section.schedule__panel');
        await panel().find('button[aria-label="Tuesday"]').trigger('click');
        const mark = server.sent.length;
        await button(panel(), 'Copy').trigger('click');
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
        await wrapper.findAll('button.track__seg')[1].trigger('click');
        const mark = server.sent.length;
        await button(form(wrapper), 'Raise priority').trigger('click');
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
        await wrapper.find('button.track__seg').trigger('click');
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
    const panel = (w: VueWrapper) => w.find('section.schedule__panel');
    const dialog = (w: VueWrapper) => w.find('[role="alertdialog"]');

    async function openCopy(w: VueWrapper, day = 'Monday'): Promise<void> {
        await selectDay(w, day);
        await button(w, 'Copy this day…').trigger('click');
    }

    const days = (ranges: WireRange[] | undefined) => (ranges ?? []).map((r) => r.day);

    it('copies at once, without asking, when no target holds a slot', async () => {
        const { wrapper, server } = await mountEditor({ heat: { 1: [MON_8_10] } });
        await openCopy(wrapper);
        await panel(wrapper).find('button[aria-label="Tuesday"]').trigger('click');
        const mark = server.sent.length;
        await button(panel(wrapper), 'Copy').trigger('click');
        await flushPromises();
        expect(dialog(wrapper).exists()).toBe(false);
        expect(writes(server, mark)).toEqual(['set_timerange:H1']);
        expect(days(server.ranges.get('H1'))).toEqual(['1', '2']);
        expect(panel(wrapper).exists()).toBe(false);
    });

    it('asks first when a target holds slots, names only those days, and writes nothing until confirmed', async () => {
        const { wrapper, server } = await mountEditor({ heat: { 1: [MON_8_10], 2: [TUE_6_7] } });
        await openCopy(wrapper);
        for (const d of ['Tuesday', 'Wednesday']) await panel(wrapper).find(`button[aria-label="${d}"]`).trigger('click');
        const mark = server.sent.length;
        await button(panel(wrapper), 'Copy').trigger('click');
        await flushPromises();
        expect(dialog(wrapper).exists()).toBe(true);
        expect(dialog(wrapper).text()).toContain('Tuesday (1 slot)');
        expect(dialog(wrapper).text()).not.toContain('Wednesday');
        expect(writes(server, mark)).toEqual([]);

        await button(dialog(wrapper), 'Replace and copy').trigger('click');
        await flushPromises();
        expect(writes(server, mark)).toEqual(['set_timerange:H1', 'set_timerange:H2']);
        // Tuesday's own 06:00-07:00 slot is overwritten, by the Monday one at the same level.
        expect(days(server.ranges.get('H1'))).toEqual(['1', '2', '3']);
        expect(server.ranges.get('H2')).toEqual([]);
        expect(panel(wrapper).exists()).toBe(false);
    });

    it('cancelling the confirmation writes nothing and keeps the panel and its targets', async () => {
        const { wrapper, server } = await mountEditor({ heat: { 1: [MON_8_10], 2: [TUE_6_7] } });
        await openCopy(wrapper);
        await panel(wrapper).find('button[aria-label="Tuesday"]').trigger('click');
        await button(panel(wrapper), 'Copy').trigger('click');
        const mark = server.sent.length;
        await button(dialog(wrapper), 'Cancel').trigger('click');
        await flushPromises();
        expect(dialog(wrapper).exists()).toBe(false);
        expect(panel(wrapper).exists()).toBe(true);
        expect(panel(wrapper).find('button[aria-label="Tuesday"]').attributes('aria-pressed')).toBe('true');
        expect(writes(server, mark)).toEqual([]);
        expect(server.ranges.get('H2')).toEqual([TUE_6_7]);
    });

    it('works on the active tab only: heating slots of the target day are replaced, cooling ones are left alone', async () => {
        const { wrapper, server } = await mountEditor({
            heat: { 1: [MON_8_10], 2: [TUE_6_7] },
            cool: { 1: [wireRange(2, 14, 0, 16, 0)] },
        });
        await openCopy(wrapper);
        await panel(wrapper).find('button[aria-label="Tuesday"]').trigger('click');
        await button(panel(wrapper), 'Copy').trigger('click');
        await button(dialog(wrapper), 'Replace and copy').trigger('click');
        await flushPromises();
        expect(writes(server).every((w) => w.startsWith('set_timerange:H'))).toBe(true);
        expect(server.writesOf('C1')).toEqual([]);
        expect(server.ranges.get('C1')).toEqual([wireRange(2, 14, 0, 16, 0)]);
        // The occupied-target check ignores the other direction too: Cooling Tuesday has a slot, Heating Wednesday none.
        await openTab(wrapper, 'Cooling (1)');
        await openCopy(wrapper, 'Wednesday');
        expect(notice(wrapper).text()).toContain('Nothing to copy');
        expect(panel(wrapper).exists()).toBe(false);
    });

    it('copies the other direction on its own tab and never touches heating', async () => {
        const { wrapper, server } = await mountEditor({ heat: { 1: [MON_8_10] }, cool: { 1: [wireRange(2, 14, 0, 16, 0)] } });
        await openTab(wrapper, 'Cooling (1)');
        await openCopy(wrapper, 'Tuesday');
        await panel(wrapper).find('button[aria-label="Thursday"]').trigger('click');
        await button(panel(wrapper), 'Copy').trigger('click');
        await flushPromises();
        expect(dialog(wrapper).exists()).toBe(false);
        expect(writes(server)).toEqual(['set_timerange:C1']);
        expect(days(server.ranges.get('C1'))).toEqual(['2', '4']);
    });

    it('refuses to open on a day with no slot, writing nothing', async () => {
        const { wrapper, server } = await mountEditor({ heat: { 1: [MON_8_10] } });
        const mark = server.sent.length;
        await openCopy(wrapper, 'Friday');
        expect(notice(wrapper).text()).toContain('Nothing to copy');
        expect(panel(wrapper).exists()).toBe(false);
        expect(writes(server, mark)).toEqual([]);
    });

    it('keeps Copy disabled until a target is picked, and never offers the source day', async () => {
        const { wrapper } = await mountEditor({ heat: { 1: [MON_8_10] } });
        await openCopy(wrapper);
        expect(button(panel(wrapper), 'Copy').attributes('disabled')).toBeDefined();
        expect(panel(wrapper).find('button[aria-label="Monday"]').attributes('disabled')).toBeDefined();
        await panel(wrapper).find('button[aria-label="Tuesday"]').trigger('click');
        expect(button(panel(wrapper), 'Copy').attributes('disabled')).toBeUndefined();
    });

    it('the Weekdays chip targets Tuesday to Friday from a Monday source, and Weekend both weekend days', async () => {
        const { wrapper, server } = await mountEditor({ heat: { 1: [MON_8_10] } });
        await openCopy(wrapper);
        await button(panel(wrapper), 'Weekdays').trigger('click');
        const pressed = () =>
            panel(wrapper)
                .findAll('.schedule__days button')
                .filter((b) => b.attributes('aria-pressed') === 'true')
                .map((b) => b.attributes('aria-label'));
        expect(pressed()).toEqual(['Tuesday', 'Wednesday', 'Thursday', 'Friday']);
        await button(panel(wrapper), 'Weekend').trigger('click');
        expect(pressed()).toEqual(['Saturday', 'Sunday']);
        await button(panel(wrapper), 'Copy').trigger('click');
        await flushPromises();
        expect(days(server.ranges.get('H1'))).toEqual(['1', '6', '7']);
    });

    it('cannot be opened when read-only', async () => {
        const { wrapper, server } = await mountEditor({ heat: { 1: [MON_8_10] }, readonly: true });
        await selectDay(wrapper, 'Monday');
        expect(button(wrapper, 'Copy this day…').attributes('disabled')).toBeDefined();
        await button(wrapper, 'Copy this day…').trigger('click');
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
        expect(segments(wrapper)).toEqual(['Level 1, 08:00 to 10:00, 22°', 'Level 1, 12:00 to 13:00, 22°']);
    });
});
