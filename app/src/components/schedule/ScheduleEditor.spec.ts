import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import type { DOMWrapper, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { messages } from '../../i18n/messages';
import type { WireRange } from '../../protocol/schedule';
import type { IoItem } from '../../protocol/types';
import { useConnectionStore } from '../../stores/connection';
import { REPLY_TIMEOUT_MS, useScheduleStore } from '../../stores/schedule';
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

/** Six heating levels, each with one Monday hour, setpoints 22, 20 ... 12. */
function sixLevels(): Record<number, WireRange[]> {
    const out: Record<number, WireRange[]> = {};
    for (let n = 1; n <= 6; n++) out[n] = [wireRange(1, 2 * n, 0, 2 * n + 1, 0)];
    return out;
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

    it('counts the levels in use on each tab and in the + Level button', async () => {
        const { wrapper } = await mountEditor({
            heat: { 1: [MON_8_10], 2: [wireRange(1, 12, 0, 14, 0)] },
            cool: { 1: [wireRange(2, 14, 0, 16, 0)] },
        });
        const tabs = wrapper.findAll('[role="tab"].schedule__tab').map((t) => t.text());
        expect(tabs).toEqual(['Heating (2)', 'Cooling (1)']);
        expect(text(wrapper)).toContain('+ Level (2 of 6)');
        await openTab(wrapper, 'Cooling (1)');
        expect(text(wrapper)).toContain('+ Level (1 of 6)');
    });

    it('ignores a seventh level and reads only the IOs it was given', async () => {
        const ios = { ...climateIos({ cool: false }), heat_level7: 'H7', heat_level7_setpoint: 'H7S' };
        const { wrapper, server } = await mountEditor({ ios });
        expect(reads(server)).not.toContain('H7');
        expect(wrapper.find('.schedule__tabs').exists()).toBe(false);
        expect(text(wrapper)).toContain('+ Level (0 of 6)');
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
        expect(text(wrapper)).toContain('+ Level (1 of 6)');
        await selectDay(wrapper, 'Monday');
        await button(wrapper, 'Add a slot').trigger('click');
        // 22.5 is not level 1's setpoint: the kept range makes level 1 busy, so the slot takes level 2.
        await fillForm(wrapper, { setpoint: 22.5 });
        const mark = server.sent.length;
        await button(form(wrapper), 'Save').trigger('click');
        await flushPromises();
        expect(writes(server, mark)).toEqual(['set_state:H2S=22.5', 'set_timerange:H2']);
        expect(server.writesOf('H1')).toEqual([]);
    });
});
