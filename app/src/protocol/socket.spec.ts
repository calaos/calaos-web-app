import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CalaosSocket,
    CONNECT_TIMEOUT_MS,
    MAX_RECONNECT_INTERVAL_MS,
    reconnectDelay,
} from './socket';
import type { SocketCloseInfo, SocketOpenInfo, SocketStatusInfo } from './socket';
import type { ServerMessage } from './types';

// ---------------------------------------------------------------------------
// Test double for the injected WebSocket constructor. Only the members the
// client touches are implemented; instances are cast to WebSocket at the
// injection point (CalaosSocketOptions.WebSocketCtor is `typeof WebSocket` on
// purpose — production code must not widen its contract for tests).
// ---------------------------------------------------------------------------

interface FakeEvent {
    data?: unknown;
    code?: number;
    reason?: string;
    wasClean?: boolean;
}

class FakeWebSocket {
    static instances: FakeWebSocket[] = [];

    static get last(): FakeWebSocket {
        const socket = FakeWebSocket.instances.at(-1);
        if (!socket) throw new Error('no FakeWebSocket was constructed');
        return socket;
    }

    static reset(): void {
        FakeWebSocket.instances = [];
    }

    readonly url: string;
    readyState = 0;
    readonly sent: string[] = [];
    readonly closeCalls: { code?: number; reason?: string }[] = [];
    throwOnSend = false;

    onopen: ((ev: FakeEvent) => void) | null = null;
    onclose: ((ev: FakeEvent) => void) | null = null;
    onerror: ((ev: FakeEvent) => void) | null = null;
    onmessage: ((ev: FakeEvent) => void) | null = null;

    constructor(url: string) {
        this.url = url;
        FakeWebSocket.instances.push(this);
    }

    send(data: string): void {
        if (this.throwOnSend) throw new Error('InvalidStateError');
        this.sent.push(data);
    }

    close(code?: number, reason?: string): void {
        this.closeCalls.push({ code, reason });
        this.readyState = 3;
    }

    // -- driven by the tests ------------------------------------------------
    fireOpen(): void {
        this.readyState = 1;
        this.onopen?.({});
    }

    fireMessage(data: unknown): void {
        this.onmessage?.({ data });
    }

    fireClose(ev: FakeEvent = { code: 1006, reason: '', wasClean: false }): void {
        this.readyState = 3;
        this.onclose?.(ev);
    }

    fireError(): void {
        this.onerror?.({});
    }

    get detached(): boolean {
        return (
            this.onopen === null &&
            this.onclose === null &&
            this.onerror === null &&
            this.onmessage === null
        );
    }
}

const FakeCtor = FakeWebSocket as unknown as typeof WebSocket;

const WS_URL = 'ws://calaos.local/api';

interface Recorded {
    open: SocketOpenInfo[];
    close: SocketCloseInfo[];
    message: ServerMessage[];
    statuschange: SocketStatusInfo[];
}

function makeSocket(): { socket: CalaosSocket; events: Recorded } {
    const socket = new CalaosSocket(WS_URL, { WebSocketCtor: FakeCtor });
    const events: Recorded = { open: [], close: [], message: [], statuschange: [] };
    socket.on('open', (e) => events.open.push(e));
    socket.on('close', (e) => events.close.push(e));
    socket.on('message', (e) => events.message.push(e));
    socket.on('statuschange', (e) => events.statuschange.push(e));
    return { socket, events };
}

/** Drives one full failed attempt: connect timeout fires, then the retry runs. */
function failByTimeout(): void {
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS);
}

beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.reset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('reconnectDelay — old reconnecting-websocket defaults', () => {
    it('is 1000 × 1.5^attempt, capped at 30000', () => {
        const sequence = Array.from({ length: 12 }, (_, attempt) => reconnectDelay(attempt));
        expect(sequence).toEqual([
            1000, 1500, 2250, 3375, 5062.5, 7593.75, 11390.625, 17085.9375, 25628.90625, 30000,
            30000, 30000,
        ]);
    });

    it('never exceeds the cap, however many attempts', () => {
        expect(reconnectDelay(1000)).toBe(MAX_RECONNECT_INTERVAL_MS);
    });
});

describe('connect', () => {
    it('does not touch the network until connect() is called', () => {
        makeSocket();
        expect(FakeWebSocket.instances).toHaveLength(0);
    });

    it('opens one socket on the given url and announces "connecting"', () => {
        const { socket, events } = makeSocket();
        socket.connect();

        expect(FakeWebSocket.instances).toHaveLength(1);
        expect(FakeWebSocket.last.url).toBe(WS_URL);
        expect(events.statuschange).toEqual([
            { status: 'connecting', attempt: 0, nextRetryMs: 0 },
        ]);
        expect(socket.status).toBe('connecting');
    });

    it('is idempotent while a connect is in flight', () => {
        const { socket } = makeSocket();
        socket.connect();
        socket.connect();
        expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('is idempotent while a retry is pending', () => {
        const { socket } = makeSocket();
        socket.connect();
        failByTimeout();
        socket.connect();
        expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('emits open (isReconnect false) and status "open" on the first success', () => {
        const { socket, events } = makeSocket();
        socket.connect();
        FakeWebSocket.last.fireOpen();

        expect(events.open).toEqual([{ isReconnect: false }]);
        expect(events.statuschange.at(-1)).toEqual({ status: 'open', attempt: 0, nextRetryMs: 0 });
        expect(socket.isOpen).toBe(true);
    });
});

describe('connect timeout (2 s)', () => {
    it('force-closes a stalled attempt and retries', () => {
        const { socket, events } = makeSocket();
        socket.connect();
        const first = FakeWebSocket.last;

        vi.advanceTimersByTime(CONNECT_TIMEOUT_MS - 1);
        expect(first.closeCalls).toHaveLength(0);
        expect(FakeWebSocket.instances).toHaveLength(1);

        vi.advanceTimersByTime(1);
        expect(first.closeCalls).toHaveLength(1);
        expect(first.detached).toBe(true);
        expect(events.statuschange.at(-1)).toEqual({
            status: 'reconnecting',
            attempt: 1,
            nextRetryMs: 1000,
        });
        // Still waiting out the backoff — no socket yet.
        expect(FakeWebSocket.instances).toHaveLength(1);

        vi.advanceTimersByTime(1000);
        expect(FakeWebSocket.instances).toHaveLength(2);
        expect(socket.status).toBe('reconnecting');
    });

    it('does not emit close for an attempt that never opened', () => {
        const { socket, events } = makeSocket();
        socket.connect();
        failByTimeout();
        expect(events.close).toEqual([]);
    });

    it('is disarmed once the socket opens', () => {
        const { socket, events } = makeSocket();
        socket.connect();
        const first = FakeWebSocket.last;
        first.fireOpen();

        vi.advanceTimersByTime(10 * CONNECT_TIMEOUT_MS);
        expect(first.closeCalls).toHaveLength(0);
        expect(FakeWebSocket.instances).toHaveLength(1);
        expect(events.statuschange.at(-1)?.status).toBe('open');
        expect(socket.isOpen).toBe(true);
    });

    it('re-arms for every retry attempt', () => {
        const { socket } = makeSocket();
        socket.connect();
        failByTimeout();
        vi.advanceTimersByTime(1000);

        const second = FakeWebSocket.last;
        vi.advanceTimersByTime(CONNECT_TIMEOUT_MS);
        expect(second.closeCalls).toHaveLength(1);
    });
});

describe('reconnect backoff', () => {
    it('walks 1000 → 1500 → 2250 → … and caps at 30000 (fake timers)', () => {
        const { socket, events } = makeSocket();
        socket.connect();

        const expected = [
            1000, 1500, 2250, 3375, 5062.5, 7593.75, 11390.625, 17085.9375, 25628.90625, 30000,
            30000, 30000,
        ];

        expected.forEach((delay, index) => {
            // The pending attempt stalls: the 2 s connect timeout fails it.
            vi.advanceTimersByTime(CONNECT_TIMEOUT_MS);
            expect(events.statuschange.at(-1)).toEqual({
                status: 'reconnecting',
                attempt: index + 1,
                nextRetryMs: delay,
            });
            expect(socket.nextRetryMs).toBe(delay);
            expect(FakeWebSocket.instances).toHaveLength(index + 1);

            // Nothing reconnects one tick early. floor(): 1.5^n delays are
            // fractional from attempt 4 on (5062.5 ms) and both the fake clock
            // and real browsers truncate a timer delay to whole ms.
            vi.advanceTimersByTime(Math.floor(delay) - 1);
            expect(FakeWebSocket.instances).toHaveLength(index + 1);
            // …and the retry fires on time.
            vi.advanceTimersByTime(1);
            expect(FakeWebSocket.instances).toHaveLength(index + 2);
        });
    });

    it('retries forever', () => {
        const { socket } = makeSocket();
        socket.connect();

        for (let i = 0; i < 200; i += 1) {
            vi.advanceTimersByTime(CONNECT_TIMEOUT_MS + MAX_RECONNECT_INTERVAL_MS);
        }
        expect(FakeWebSocket.instances.length).toBeGreaterThan(190);
        expect(socket.attempt).toBeGreaterThan(190);
        expect(socket.nextRetryMs).toBe(MAX_RECONNECT_INTERVAL_MS);
    });

    it('backs off on a refused connect (close before open) too', () => {
        const { socket, events } = makeSocket();
        socket.connect();
        FakeWebSocket.last.fireClose({ code: 1006, reason: '', wasClean: false });

        expect(events.close).toEqual([]);
        expect(events.statuschange.at(-1)).toEqual({
            status: 'reconnecting',
            attempt: 1,
            nextRetryMs: 1000,
        });
        expect(socket.attempt).toBe(1);
    });

    it('treats an error event as a failed attempt (no browser close needed)', () => {
        const { socket } = makeSocket();
        socket.connect();
        const first = FakeWebSocket.last;
        first.fireError();

        expect(first.closeCalls).toHaveLength(1);
        expect(socket.status).toBe('reconnecting');
        vi.advanceTimersByTime(1000);
        expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it('resets the attempt counter on a successful open', () => {
        const { socket, events } = makeSocket();
        socket.connect();

        failByTimeout();
        vi.advanceTimersByTime(1000);
        failByTimeout();
        vi.advanceTimersByTime(1500);
        expect(socket.attempt).toBe(2);

        FakeWebSocket.last.fireOpen();
        expect(socket.attempt).toBe(0);
        expect(events.open.at(-1)).toEqual({ isReconnect: true });

        // A later drop starts the backoff from the base interval again.
        FakeWebSocket.last.fireClose({ code: 1006, reason: 'gone', wasClean: false });
        expect(events.statuschange.at(-1)).toEqual({
            status: 'reconnecting',
            attempt: 1,
            nextRetryMs: 1000,
        });
    });

    it('emits close only for a socket that had opened, then reconnects', () => {
        const { socket, events } = makeSocket();
        socket.connect();
        FakeWebSocket.last.fireOpen();
        FakeWebSocket.last.fireClose({ code: 1001, reason: 'bye', wasClean: true });

        expect(events.close).toEqual([{ code: 1001, reason: 'bye', wasClean: true }]);
        vi.advanceTimersByTime(1000);
        expect(FakeWebSocket.instances).toHaveLength(2);

        FakeWebSocket.last.fireOpen();
        expect(socket.isOpen).toBe(true);
        expect(events.open.at(-1)).toEqual({ isReconnect: true });
    });

    it('ignores late events from a stale socket', () => {
        const { socket, events } = makeSocket();
        socket.connect();
        const first = FakeWebSocket.last;
        failByTimeout();
        vi.advanceTimersByTime(1000);
        const second = FakeWebSocket.last;
        expect(second).not.toBe(first);

        const statusCount = events.statuschange.length;
        first.fireClose();
        first.fireOpen();
        first.fireMessage('{"msg":"login","data":{"success":"true"}}');

        expect(events.statuschange).toHaveLength(statusCount);
        expect(events.message).toEqual([]);
        expect(socket.status).toBe('reconnecting');

        second.fireOpen();
        expect(socket.isOpen).toBe(true);
        expect(FakeWebSocket.instances).toHaveLength(2);
    });
});

describe('messages', () => {
    it('decodes incoming frames with decodeServerMessage', () => {
        const { socket, events } = makeSocket();
        socket.connect();
        FakeWebSocket.last.fireOpen();

        FakeWebSocket.last.fireMessage('{"msg":"login","data":{"success":"true"}}');
        FakeWebSocket.last.fireMessage(
            '{"msg":"event","data":{"type_str":"io_changed","data":{"id":"io_3","state":"true"}}}',
        );

        expect(events.message).toEqual([
            { kind: 'login', success: true },
            { kind: 'io_changed', id: 'io_3', state: 'true' },
        ]);
    });

    // decodeServerMessage never throws; the socket EMITS the typed fallback
    // rather than dropping it, and keeps running.
    it.each([['not json at all'], ['{"msg":'], [''], ['[1,2,3]'], ['{"msg":"nope"}']])(
        'survives the malformed frame %o',
        (frame) => {
            const { socket, events } = makeSocket();
            socket.connect();
            FakeWebSocket.last.fireOpen();

            expect(() => FakeWebSocket.last.fireMessage(frame)).not.toThrow();
            expect(events.message).toHaveLength(1);
            expect(events.message[0]?.kind).toBe('unknown');

            // Still open, still decoding, no retry triggered.
            FakeWebSocket.last.fireMessage('{"msg":"login","data":{"success":"false"}}');
            expect(events.message.at(-1)).toEqual({ kind: 'login', success: false });
            expect(socket.isOpen).toBe(true);
            expect(FakeWebSocket.instances).toHaveLength(1);
        },
    );

    it('survives non-string payloads (binary frames)', () => {
        const { socket, events } = makeSocket();
        socket.connect();
        FakeWebSocket.last.fireOpen();

        expect(() => FakeWebSocket.last.fireMessage(new ArrayBuffer(4))).not.toThrow();
        expect(events.message).toHaveLength(1);
        expect(events.message[0]?.kind).toBe('unknown');
        expect(socket.isOpen).toBe(true);
    });
});

describe('send', () => {
    it('writes the frame verbatim when open', () => {
        const { socket } = makeSocket();
        socket.connect();
        FakeWebSocket.last.fireOpen();

        expect(socket.send('{"msg":"get_home"}')).toBe(true);
        expect(FakeWebSocket.last.sent).toEqual(['{"msg":"get_home"}']);
    });

    it('drops (never queues) while connecting or reconnecting', () => {
        const { socket } = makeSocket();
        socket.connect();
        expect(socket.send('{"msg":"get_home"}')).toBe(false);
        expect(FakeWebSocket.last.sent).toEqual([]);

        failByTimeout();
        expect(socket.send('{"msg":"get_home"}')).toBe(false);

        vi.advanceTimersByTime(1000);
        FakeWebSocket.last.fireOpen();
        // Nothing was replayed on reconnect.
        expect(FakeWebSocket.last.sent).toEqual([]);
    });

    it('reports a throwing underlying send instead of propagating', () => {
        const { socket } = makeSocket();
        socket.connect();
        FakeWebSocket.last.fireOpen();
        FakeWebSocket.last.throwOnSend = true;

        expect(socket.send('{"msg":"get_home"}')).toBe(false);
        expect(console.warn).toHaveBeenCalled();
    });
});

describe('listeners', () => {
    it('off() stops delivery', () => {
        const socket = new CalaosSocket(WS_URL, { WebSocketCtor: FakeCtor });
        const seen: ServerMessage[] = [];
        const listener = (msg: ServerMessage): void => {
            seen.push(msg);
        };
        socket.on('message', listener);
        socket.connect();
        FakeWebSocket.last.fireOpen();

        FakeWebSocket.last.fireMessage('{"msg":"login","data":{"success":"true"}}');
        socket.off('message', listener);
        FakeWebSocket.last.fireMessage('{"msg":"login","data":{"success":"false"}}');

        expect(seen).toEqual([{ kind: 'login', success: true }]);
    });

    it('tolerates a listener removing itself while being notified', () => {
        const socket = new CalaosSocket(WS_URL, { WebSocketCtor: FakeCtor });
        const seen: string[] = [];
        const once = (): void => {
            seen.push('once');
            socket.off('statuschange', once);
        };
        socket.on('statuschange', once);
        socket.connect();
        failByTimeout();

        expect(seen).toEqual(['once']);
    });
});

describe('close', () => {
    it('stops the reconnect loop permanently', () => {
        const { socket, events } = makeSocket();
        socket.connect();
        FakeWebSocket.last.fireOpen();
        socket.close();

        expect(FakeWebSocket.last.closeCalls).toEqual([{ code: 1000, reason: '' }]);
        expect(events.close).toEqual([{ code: 1000, reason: '', wasClean: true }]);

        vi.advanceTimersByTime(10 * MAX_RECONNECT_INTERVAL_MS);
        expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('cancels a pending retry', () => {
        const { socket } = makeSocket();
        socket.connect();
        failByTimeout();
        socket.close();

        vi.advanceTimersByTime(10 * MAX_RECONNECT_INTERVAL_MS);
        expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('can be reopened with connect()', () => {
        const { socket } = makeSocket();
        socket.connect();
        FakeWebSocket.last.fireOpen();
        socket.close();

        socket.connect();
        expect(FakeWebSocket.instances).toHaveLength(2);
        FakeWebSocket.last.fireOpen();
        expect(socket.isOpen).toBe(true);
    });
});
