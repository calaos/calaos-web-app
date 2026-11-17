// Climate program I/O: get_timerange / set_timerange on the level IOs, and the
// setpoint / default / switch IOs the editor reads and writes. Those IOs are
// hidden (owned by the climate), so they are not in the home store: their
// values are kept here, fed by get_state answers and io_changed.

import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';
import { ALL_MONTHS, toWireRange } from '../protocol/schedule';
import type { WireRange } from '../protocol/schedule';
import { encodeGetState, encodeGetTimerange, encodeSetState, encodeSetTimerange } from '../protocol/messages';
import type { SetStateResultMessage, TimerangeMessage } from '../protocol/types';

export type FrameSender = (frame: string) => boolean;

/** No answer in this time is a failure the user can retry. */
export const REPLY_TIMEOUT_MS = 8000;
const MSG_PREFIX = 'sch-';

type Reply = TimerangeMessage | SetStateResultMessage | { kind: 'timeout' } | { kind: 'not_sent' };

export const useScheduleStore = defineStore('schedule', () => {
    /** id → raw state of the program IOs asked for so far. */
    const values = reactive(new Map<string, string>());
    /** Bumped on every timerange_changed; `changedId` says which. */
    const changes = ref(0);
    const changedId = ref('');

    const watched = new Set<string>();
    const waiters = new Map<string, { done: (r: Reply) => void; timer: ReturnType<typeof setTimeout> }>();
    let seq = 0;
    let send: FrameSender = () => false;

    function attachTransport(sender: FrameSender): void {
        send = sender;
    }

    function request(build: (msgId: string) => string): Promise<Reply> {
        const msgId = `${MSG_PREFIX}${++seq}`;
        return new Promise((resolve) => {
            if (!send(build(msgId))) {
                resolve({ kind: 'not_sent' });
                return;
            }
            const timer = setTimeout(() => {
                waiters.delete(msgId);
                resolve({ kind: 'timeout' });
            }, REPLY_TIMEOUT_MS);
            waiters.set(msgId, { done: resolve, timer });
        });
    }

    /** True when the answer was for this store (msg_id it issued). */
    function applyReply(msg: TimerangeMessage | SetStateResultMessage): boolean {
        if (!msg.msgId.startsWith(MSG_PREFIX)) return false;
        const waiter = waiters.get(msg.msgId);
        if (waiter) {
            clearTimeout(waiter.timer);
            waiters.delete(msg.msgId);
            waiter.done(msg);
        }
        return true;
    }

    function applyStates(ios: Record<string, string>): void {
        for (const [id, state] of Object.entries(ios)) if (watched.has(id)) values.set(id, state);
    }

    function applyIoChanged(id: string, state: string | undefined): void {
        if (state !== undefined && watched.has(id)) values.set(id, state);
    }

    function applyTimerangeChanged(data: unknown): void {
        const id = typeof data === 'object' && data !== null ? (data as { id?: unknown }).id : undefined;
        if (typeof id !== 'string' || id === '') return;
        changedId.value = id;
        changes.value++;
    }

    /** Starts following these IOs and asks for their current value. */
    function watchValues(ids: string[]): void {
        const wanted = ids.filter((id) => id !== '');
        for (const id of wanted) watched.add(id);
        if (wanted.length > 0) send(encodeGetState(wanted));
    }

    async function readRanges(id: string): Promise<{ ranges: WireRange[]; error: string }> {
        const reply = await request((msgId) => encodeGetTimerange(id, msgId));
        if (reply.kind !== 'timerange') return { ranges: [], error: reply.kind === 'timeout' ? 'timeout' : 'offline' };
        if (reply.error !== '') return { ranges: [], error: reply.error };
        const ranges = reply.ranges.map(toWireRange).filter((r): r is WireRange => r !== null);
        return { ranges, error: '' };
    }

    /** '' on success, else the server's error string (or timeout / offline). */
    async function writeRanges(id: string, ranges: WireRange[]): Promise<string> {
        const reply = await request((msgId) => encodeSetTimerange(id, ALL_MONTHS, ranges, msgId));
        if (reply.kind === 'timerange') return reply.error;
        return reply.kind === 'timeout' ? 'timeout' : 'offline';
    }

    async function writeValue(id: string, value: string): Promise<string> {
        const reply = await request((msgId) => encodeSetState(id, value, msgId));
        if (reply.kind === 'set_state') {
            if (reply.success) values.set(id, value);
            return reply.success ? '' : 'failed';
        }
        return reply.kind === 'timeout' ? 'timeout' : 'offline';
    }

    function clear(): void {
        for (const { done, timer } of waiters.values()) {
            clearTimeout(timer);
            done({ kind: 'not_sent' });
        }
        waiters.clear();
        values.clear();
        watched.clear();
    }

    return {
        values,
        changes,
        changedId,
        attachTransport,
        applyReply,
        applyStates,
        applyIoChanged,
        applyTimerangeChanged,
        watchValues,
        readRanges,
        writeRanges,
        writeValue,
        clear,
    };
});
