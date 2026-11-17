// A fake calaos_server for the schedule store and editor specs: it answers
// get_timerange / set_timerange / set_state / get_state frames the store sends,
// one microtask later (the store registers its waiter after send() returns).

import { decodeServerMessage } from '../protocol/messages';
import type { WireRange } from '../protocol/schedule';
import { useScheduleStore } from './schedule';

export type Frame = { msg: string; msg_id: string; data: Record<string, unknown> };

export function wireRange(day: number, sh: number, sm: number, eh: number, em: number, es = 0): WireRange {
    return {
        day: String(day),
        start_hour: String(sh),
        start_min: String(sm),
        start_sec: '0',
        start_type: '0',
        start_offset: '0',
        end_hour: String(eh),
        end_min: String(em),
        end_sec: String(es),
        end_type: '0',
        end_offset: '0',
    };
}

export interface FakeServer {
    /** Every frame the store sent, in order. */
    sent: Frame[];
    /** id → ranges the server holds. */
    ranges: Map<string, WireRange[]>;
    /** id → months mask a get_timerange answers; all months when absent. */
    months: Map<string, string>;
    /** id → raw state (setpoints, defaults, switches). */
    values: Map<string, string>;
    /** false: send() refuses, as a closed socket does. */
    online: boolean;
    /** Ids whose requests never get an answer. */
    silent: Set<string>;
    /** Returns an error string to refuse this set_timerange, '' or undefined to accept. */
    refuseRanges: (id: string, nth: number) => string | undefined;
    /** Returns an error string to fail this get_timerange, '' or undefined to answer. */
    refuseReads: (id: string) => string | undefined;
    /** true: answer this set_state with success 'false'. */
    refuseValue: (id: string) => boolean;
    writesOf(id: string): WireRange[][];
}

export function fakeServer(): FakeServer {
    const store = useScheduleStore();
    const counts = new Map<string, number>();
    const server: FakeServer = {
        sent: [],
        ranges: new Map(),
        months: new Map(),
        values: new Map(),
        online: true,
        silent: new Set(),
        refuseRanges: () => undefined,
        refuseReads: () => undefined,
        refuseValue: () => false,
        writesOf: (id) =>
            server.sent
                .filter((f) => f.msg === 'set_timerange' && f.data.id === id)
                .map((f) => f.data.ranges as WireRange[]),
    };

    function reply(frame: Frame): void {
        const id = String(frame.data.id ?? '');
        if (server.silent.has(id)) return;
        let data: Record<string, unknown> | undefined;
        if (frame.msg === 'get_timerange') {
            const error = server.refuseReads(id);
            data = error
                ? { error }
                : { months: server.months.get(id) ?? '111111111111', ranges: (server.ranges.get(id) ?? []).map((r) => ({ ...r })) };
        } else if (frame.msg === 'set_timerange') {
            const nth = (counts.get(id) ?? 0) + 1;
            counts.set(id, nth);
            const error = server.refuseRanges(id, nth) ?? '';
            if (error === '') server.ranges.set(id, frame.data.ranges as WireRange[]);
            data = error === '' ? { success: 'true', months: frame.data.months } : { success: 'false', error };
        } else if (frame.msg === 'set_state') {
            const refused = server.refuseValue(id);
            if (!refused) server.values.set(id, String(frame.data.value));
            data = { success: refused ? 'false' : 'true' };
        } else if (frame.msg === 'get_state') {
            const out: Record<string, string> = {};
            for (const wanted of frame.data.items as string[]) {
                const v = server.values.get(wanted);
                if (v !== undefined) out[wanted] = v;
            }
            store.applyStates(out);
            return;
        }
        const msg = decodeServerMessage({ msg: frame.msg, msg_id: frame.msg_id, data });
        if (msg.kind === 'timerange' || msg.kind === 'set_state') store.applyReply(msg);
    }

    store.attachTransport((raw) => {
        if (!server.online) return false;
        const frame = JSON.parse(raw) as Frame;
        server.sent.push(frame);
        void Promise.resolve().then(() => reply(frame));
        return true;
    });
    return server;
}
