import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { REPLY_TIMEOUT_MS, useScheduleStore } from './schedule';
import { fakeServer, wireRange } from './scheduleTestHarness';
import type { Frame } from './scheduleTestHarness';

// Real timers: the fake server answers one microtask later. Only the 8 s
// timeout needs a clock, and then only setTimeout is faked.
beforeEach(() => {
    setActivePinia(createPinia());
});

afterEach(() => {
    vi.useRealTimers();
});

function fakeClock(): void {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
}

/** A transport that records frames and answers nothing. */
function mute(): Frame[] {
    const frames: Frame[] = [];
    useScheduleStore().attachTransport((raw) => {
        frames.push(JSON.parse(raw) as Frame);
        return true;
    });
    return frames;
}

describe('reading a level', () => {
    it('returns the ranges the server holds, and asks for exactly that IO', async () => {
        const store = useScheduleStore();
        const server = fakeServer();
        server.ranges.set('heat_level1', [wireRange(1, 6, 0, 8, 30), wireRange(2, 6, 0, 8, 30)]);

        const read = await store.readRanges('heat_level1');

        expect(read.error).toBe('');
        expect(read.ranges).toEqual([wireRange(1, 6, 0, 8, 30), wireRange(2, 6, 0, 8, 30)]);
        expect(server.sent).toHaveLength(1);
        expect(server.sent[0]).toMatchObject({ msg: 'get_timerange', data: { id: 'heat_level1' } });
    });

    it('returns the server error and no range', async () => {
        const store = useScheduleStore();
        const frames = mute();
        const pending = store.readRanges('heat_level1');
        store.applyReply({ kind: 'timerange', op: 'get', msgId: frames[0].msg_id, error: 'wrong input', months: '', ranges: [] });

        expect(await pending).toEqual({ ranges: [], error: 'wrong input' });
    });

    it('drops the ranges the server sent malformed instead of failing the read', async () => {
        const store = useScheduleStore();
        const frames = mute();
        const pending = store.readRanges('heat_level1');
        store.applyReply({
            kind: 'timerange',
            op: 'get',
            msgId: frames[0].msg_id,
            error: '',
            months: '111111111111',
            ranges: [wireRange(3, 7, 0, 9, 0), { day: 'x' }, null, 'junk', 42],
        });

        const read = await pending;
        expect(read.error).toBe('');
        expect(read.ranges).toEqual([wireRange(3, 7, 0, 9, 0)]);
    });

    it('reports offline when the socket refuses the frame, with nothing left pending', async () => {
        fakeClock();
        const store = useScheduleStore();
        const server = fakeServer();
        server.online = false;

        expect(await store.readRanges('heat_level1')).toEqual({ ranges: [], error: 'offline' });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('reports a timeout after exactly REPLY_TIMEOUT_MS of silence, not before', async () => {
        fakeClock();
        const store = useScheduleStore();
        mute();
        let outcome: { error: string } | undefined;
        const pending = store.readRanges('heat_level1').then((r) => (outcome = r));

        await vi.advanceTimersByTimeAsync(REPLY_TIMEOUT_MS - 1);
        expect(outcome).toBeUndefined();
        await vi.advanceTimersByTimeAsync(1);
        await pending;
        expect(outcome?.error).toBe('timeout');
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('writing', () => {
    it('writeRanges sends the ranges and succeeds with an empty error', async () => {
        const store = useScheduleStore();
        const server = fakeServer();

        expect(await store.writeRanges('heat_level2', [wireRange(1, 6, 0, 7, 0)])).toBe('');

        expect(server.sent[0]).toMatchObject({
            msg: 'set_timerange',
            data: { id: 'heat_level2', ranges: [wireRange(1, 6, 0, 7, 0)] },
        });
        expect(server.sent[0].data).not.toHaveProperty('months');
        expect(server.ranges.get('heat_level2')).toEqual([wireRange(1, 6, 0, 7, 0)]);
    });

    it('writeRanges clears a level with an empty list', async () => {
        const store = useScheduleStore();
        const server = fakeServer();
        server.ranges.set('heat_level2', [wireRange(1, 6, 0, 7, 0)]);

        expect(await store.writeRanges('heat_level2', [])).toBe('');

        expect(server.ranges.get('heat_level2')).toEqual([]);
    });

    it("writeRanges returns the server's error string verbatim", async () => {
        const store = useScheduleStore();
        const server = fakeServer();
        server.refuseRanges = () => 'config_not_written';

        expect(await store.writeRanges('heat_level2', [])).toBe('config_not_written');
    });

    it('writeRanges treats an answer without success as a failure, never as ok', async () => {
        const store = useScheduleStore();
        const frames = mute();
        const pending = store.writeRanges('heat_level2', []);
        store.applyReply({ kind: 'timerange', op: 'set', msgId: frames[0].msg_id, error: 'failed', months: '', ranges: [] });

        expect(await pending).toBe('failed');
    });

    it('writeValue records the value only once the server accepted it', async () => {
        const store = useScheduleStore();
        const server = fakeServer();

        expect(await store.writeValue('heat_level1_setpoint', '19.5')).toBe('');
        expect(store.values.get('heat_level1_setpoint')).toBe('19.5');
        expect(server.sent[0]).toMatchObject({ msg: 'set_state', data: { id: 'heat_level1_setpoint', value: '19.5' } });
    });

    it('writeValue keeps the previous value when the server refuses, and says so', async () => {
        const store = useScheduleStore();
        const server = fakeServer();
        store.watchValues(['heat_level1_setpoint']);
        store.applyStates({ heat_level1_setpoint: '18' });
        server.refuseValue = () => true;

        expect(await store.writeValue('heat_level1_setpoint', '25')).toBe('failed');
        expect(store.values.get('heat_level1_setpoint')).toBe('18');
    });

    it('offline and timeout are distinguishable from a refusal, for ranges and for values', async () => {
        fakeClock();
        const store = useScheduleStore();
        const server = fakeServer();
        server.online = false;
        expect(await store.writeRanges('heat_level1', [])).toBe('offline');
        expect(await store.writeValue('heat_default', '17')).toBe('offline');
        expect(store.values.has('heat_default')).toBe(false);

        server.online = true;
        server.silent.add('heat_level1');
        server.silent.add('heat_default');
        const ranges = store.writeRanges('heat_level1', []);
        const value = store.writeValue('heat_default', '17');
        await vi.advanceTimersByTimeAsync(REPLY_TIMEOUT_MS);
        expect(await ranges).toBe('timeout');
        expect(await value).toBe('timeout');
        expect(store.values.has('heat_default')).toBe(false);
    });
});

describe('replies and message ids', () => {
    it('every request carries a distinct sch- msg_id', async () => {
        const store = useScheduleStore();
        const server = fakeServer();
        await Promise.all([store.readRanges('a'), store.readRanges('b'), store.writeValue('c', '1')]);

        const ids = server.sent.map((f) => f.msg_id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.every((id) => id.startsWith('sch-'))).toBe(true);
    });

    it('a reply for another feature is left alone (applyReply false) and resolves nothing', async () => {
        const store = useScheduleStore();
        mute();
        let done = false;
        void store.readRanges('heat_level1').then(() => (done = true));

        const mine = store.applyReply({ kind: 'set_state', msgId: 'home-7', success: true });
        await Promise.resolve();

        expect(mine).toBe(false);
        expect(done).toBe(false);
    });

    it('a late answer after the timeout is ours but harmless', async () => {
        fakeClock();
        const store = useScheduleStore();
        const frames = mute();
        const pending = store.readRanges('heat_level1');
        await vi.advanceTimersByTimeAsync(REPLY_TIMEOUT_MS);
        expect((await pending).error).toBe('timeout');

        const late = store.applyReply({ kind: 'timerange', op: 'get', msgId: frames[0].msg_id, error: '', months: '', ranges: [] });

        expect(late).toBe(true);
    });

    it('a duplicated answer resolves the request once and the second is ignored', async () => {
        const store = useScheduleStore();
        const frames = mute();
        const pending = store.writeRanges('heat_level1', []);
        const ok: Parameters<typeof store.applyReply>[0] = { kind: 'timerange', op: 'set', msgId: frames[0].msg_id, error: '', months: '', ranges: [] };
        store.applyReply(ok);
        store.applyReply({ ...ok, error: 'late failure' });

        expect(await pending).toBe('');
    });

    // Seeded shuffle: answers arrive in any order, each lands on its own request.
    it.each([1, 2, 3, 4, 5, 6, 7, 8])('answers in a shuffled order reach the right request (seed %i)', async (seed) => {
        const store = useScheduleStore();
        const frames = mute();
        const ids = Array.from({ length: 6 }, (_, i) => `heat_level${String(i + 1)}`);
        const pending = ids.map((id) => store.readRanges(id));

        let state = seed * 2654435761;
        const rand = () => {
            state = (state * 1664525 + 1013904223) % 4294967296;
            return state / 4294967296;
        };
        const order = frames.map((_, i) => i).sort(() => rand() - 0.5);
        for (const i of order) {
            const day = i + 1;
            store.applyReply({
                kind: 'timerange',
                op: 'get',
                msgId: frames[i].msg_id,
                error: '',
                months: '',
                ranges: [wireRange(day, 6, 0, 7, 0)],
            });
        }

        const results = await Promise.all(pending);
        results.forEach((r, i) => {
            expect(frames[i].data.id).toBe(ids[i]);
            expect(r.ranges).toEqual([wireRange(i + 1, 6, 0, 7, 0)]);
        });
    });
});

describe('watched values', () => {
    it('watchValues asks for the non-empty ids in one get_state, and nothing for an empty list', () => {
        const store = useScheduleStore();
        const frames = mute();

        store.watchValues(['', '']);
        expect(frames).toHaveLength(0);
        store.watchValues(['heat_default', '', 'cool_default']);

        expect(frames).toHaveLength(1);
        expect(frames[0]).toMatchObject({ msg: 'get_state', data: { items: ['heat_default', 'cool_default'] } });
    });

    it('get_state and io_changed update watched IOs only', () => {
        const store = useScheduleStore();
        mute();
        store.watchValues(['heat_default']);

        store.applyStates({ heat_default: '17', light_1: 'true' });
        store.applyIoChanged('heat_default', '18');
        store.applyIoChanged('light_1', 'true');

        expect([...store.values.entries()]).toEqual([['heat_default', '18']]);
    });

    it('an io_changed without a state does not erase the value', () => {
        const store = useScheduleStore();
        mute();
        store.watchValues(['heat_default']);
        store.applyStates({ heat_default: '17' });

        store.applyIoChanged('heat_default', undefined);

        expect(store.values.get('heat_default')).toBe('17');
    });

    it('the fake server answers a get_state with the stored values of what was asked', async () => {
        const store = useScheduleStore();
        const server = fakeServer();
        server.values.set('heat_default', '17');
        server.values.set('unwatched', '1');
        store.watchValues(['heat_default', 'cool_default']);
        await Promise.resolve();
        await Promise.resolve();

        expect([...store.values.entries()]).toEqual([['heat_default', '17']]);
    });
});

describe('timerange_changed', () => {
    it('bumps the counter once per event and names the level', () => {
        const store = useScheduleStore();

        store.applyTimerangeChanged({ id: 'heat_level3' });
        expect([store.changes, store.changedId]).toEqual([1, 'heat_level3']);
        store.applyTimerangeChanged({ id: 'heat_level3' });
        store.applyTimerangeChanged({ id: 'cool_level1' });

        expect([store.changes, store.changedId]).toEqual([3, 'cool_level1']);
    });

    it.each([
        ['no payload', undefined],
        ['null', null],
        ['a string', 'heat_level1'],
        ['a number', 7],
        ['an array', ['heat_level1']],
        ['no id', {}],
        ['an empty id', { id: '' }],
        ['a numeric id', { id: 3 }],
        ['a null id', { id: null }],
    ])('ignores %s', (_label, payload) => {
        const store = useScheduleStore();

        store.applyTimerangeChanged(payload);

        expect([store.changes, store.changedId]).toEqual([0, '']);
    });
});

describe('clear (sign-out, reconnect)', () => {
    it('settles every pending request as offline, cancels its timer, and forgets the values', async () => {
        fakeClock();
        const store = useScheduleStore();
        mute();
        store.watchValues(['heat_default']);
        store.applyStates({ heat_default: '17' });
        const read = store.readRanges('heat_level1');
        const write = store.writeRanges('heat_level2', []);

        store.clear();

        expect((await read).error).toBe('offline');
        expect(await write).toBe('offline');
        expect(vi.getTimerCount()).toBe(0);
        expect(store.values.size).toBe(0);
        store.applyStates({ heat_default: '99' });
        expect(store.values.size).toBe(0);
    });

    it('a request answered after clear() does not resurrect anything', async () => {
        const store = useScheduleStore();
        const frames = mute();
        const pending = store.readRanges('heat_level1');
        store.clear();
        await pending;

        const ours = store.applyReply({ kind: 'timerange', op: 'get', msgId: frames[0].msg_id, error: '', months: '', ranges: [] });

        expect(ours).toBe(true);
        expect(store.values.size).toBe(0);
    });
});

describe('the raw wire frames the store sends', () => {
    it('are valid JSON with msg_id at the top level, as the server expects', () => {
        const store = useScheduleStore();
        const frames = mute();
        void store.readRanges('heat_level1');
        void store.writeRanges('heat_level1', []);
        void store.writeValue('heat_default', '17');

        expect(frames.map((f) => f.msg)).toEqual(['get_timerange', 'set_timerange', 'set_state']);
        expect(frames.every((f) => typeof f.msg_id === 'string' && f.msg_id !== '')).toBe(true);
    });
});
