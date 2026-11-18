import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { toHomeData } from '../protocol/guards';
import { useConnectionStore } from '../stores/connection';
import { useHomeStore } from '../stores/home';
import { useScheduleStore } from '../stores/schedule';
import { fakeServer, wireRange } from '../stores/scheduleTestHarness';
import type { FakeServer } from '../stores/scheduleTestHarness';
import { useProgramTracks } from './useProgramTracks';
import type { UseProgramTracks } from './useProgramTracks';

const IOS = {
    heat_level1: 'H1',
    heat_level1_setpoint: 'H1S',
    cool_level1: 'C1',
    cool_level1_setpoint: 'C1S',
    heat_default: 'HD',
    cool_default: 'CD',
    cool_default_off: 'CO',
};

let server: FakeServer;

function setup(enabled = true, ios: Record<string, string> = IOS) {
    useHomeStore().setHome(
        toHomeData({
            home: [{ items: [{ id: 'c', name: 'C', gui_type: 'climate', state: '', visible: 'true', device: { family: 'climate', impl: 'proxy', capabilities: {}, state: {}, ios } }] }],
        }),
    );
    const on = ref(enabled);
    let result!: UseProgramTracks;
    const w = mount(
        defineComponent({
            setup() {
                result = useProgramTracks(() => useHomeStore().ios.get('c')!, on);
                return () => null;
            },
        }),
    );
    return { tracks: result, on, w };
}

const reads = () => server.sent.filter((f) => f.msg === 'get_timerange').length;

beforeEach(() => {
    setActivePinia(createPinia());
    useConnectionStore().applyStatus({ status: 'open', attempt: 0, nextRetryMs: 0 });
    server = fakeServer();
    server.ranges.set('H1', [wireRange(3, 8, 0, 10, 0)]);
    server.ranges.set('C1', [wireRange(3, 14, 0, 16, 0)]);
    server.values.set('H1S', '21');
    server.values.set('C1S', '25.5');
    server.values.set('HD', '17');
    server.values.set('CD', '28');
});

describe('useProgramTracks', () => {
    it('reads nothing while disabled, then loads both directions when enabled', async () => {
        const { tracks, on } = setup(false);
        await flushPromises();
        expect(reads()).toBe(0);
        expect(tracks.programs.value).toEqual({});

        on.value = true;
        await flushPromises();
        expect(reads()).toBe(2);
        expect(tracks.programs.value.heat?.slots).toHaveLength(1);
        expect(tracks.programs.value.cool?.slots).toHaveLength(1);
        expect([tracks.loading.value, tracks.failed.value]).toEqual([false, false]);
    });

    it('sets loading while the first read is in flight', async () => {
        server.held.add('H1');
        const { tracks } = setup();
        await nextTick();
        expect(tracks.loading.value).toBe(true);
        server.release();
        await flushPromises();
        expect(tracks.loading.value).toBe(false);
    });

    it('overlays the setpoint values the store watches and exposes the defaults', async () => {
        const { tracks } = setup();
        await flushPromises();
        expect(tracks.programs.value.heat?.levels[0].setpoint).toBe(21);
        expect(tracks.programs.value.cool?.levels[0].setpoint).toBe(25.5);
        expect(tracks.defaultOf('heat')).toBe(17);
        expect(tracks.defaultOf('cool')).toBe(28);
        expect(tracks.coolOff.value).toBe(false);


        useScheduleStore().applyIoChanged('CO', 'true');
        expect(tracks.coolOff.value).toBe(true);
    });

    it('treats a blank or non-numeric value as unknown', async () => {
        server.values.set('HD', ' ');
        server.values.set('CD', 'abc');
        const { tracks } = setup();
        await flushPromises();
        expect(tracks.defaultOf('heat')).toBeUndefined();
        expect(tracks.defaultOf('cool')).toBeUndefined();
    });

    it('has nothing to read, and no failure, without level IOs', async () => {
        const { tracks } = setup(true, {});
        await flushPromises();
        expect(reads()).toBe(0);
        expect([tracks.loading.value, tracks.failed.value]).toEqual([false, false]);
        expect(tracks.defaultOf('heat')).toBeUndefined();
    });

    it('reloads when one of its levels changed, and only then', async () => {
        const { tracks } = setup();
        await flushPromises();
        const before = reads();
        const store = useScheduleStore();

        store.applyTimerangeChanged({ id: 'UNRELATED' });
        await flushPromises();
        expect(reads()).toBe(before);

        server.ranges.set('H1', [wireRange(3, 8, 0, 10, 0), wireRange(4, 8, 0, 10, 0)]);
        store.applyTimerangeChanged({ id: 'H1' });
        await flushPromises();
        expect(reads()).toBeGreaterThan(before);
        expect(tracks.programs.value.heat?.slots).toHaveLength(2);
    });

    it('does not reload on a change while disabled', async () => {
        const { on } = setup();
        await flushPromises();
        on.value = false;
        const before = reads();
        useScheduleStore().applyTimerangeChanged({ id: 'H1' });
        await flushPromises();
        expect(reads()).toBe(before);
    });

    it('flags a failed read, and keeps what it had drawn rather than an empty strip', async () => {
        const { tracks } = setup();
        await flushPromises();
        expect(tracks.programs.value.heat?.slots).toHaveLength(1);

        server.refuseReads = (id) => (id === 'H1' ? 'boom' : undefined);
        server.ranges.set('H1', []);
        await tracks.reload();
        expect(tracks.failed.value).toBe(true);
        expect(tracks.programs.value.heat?.slots).toHaveLength(1);

        server.refuseReads = () => undefined;
        await tracks.reload();
        expect(tracks.failed.value).toBe(false);
        expect(tracks.programs.value.heat?.slots).toHaveLength(0);
    });

    it('draws an empty direction when its first read fails', async () => {
        server.refuseReads = (id) => (id === 'C1' ? 'boom' : undefined);
        const { tracks } = setup();
        await flushPromises();
        expect(tracks.failed.value).toBe(true);
        expect(tracks.programs.value.cool?.slots).toEqual([]);
        expect(tracks.programs.value.heat?.slots).toHaveLength(1);
    });

    it('ignores a result that arrives after its scope was disposed', async () => {
        server.held.add('H1');
        const { tracks, w } = setup();
        await nextTick();
        expect(tracks.loading.value).toBe(true);
        w.unmount();
        server.release();
        await flushPromises();
        expect(tracks.loading.value).toBe(true);
    });
});
