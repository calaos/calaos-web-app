import { describe, expect, it } from 'vitest';
import {
    CONSOLE_PROTOCOL,
    ConsoleConnection,
    classifyClose,
    clampSize,
    consoleUrl,
    encodeInput,
    encodeOpen,
    encodeResize,
    endsAdminSession,
    parseConsoleText,
} from './console';
import type { CloseContext, ConsoleEnd, ConsoleOpen, ConsoleReady } from './console';

const SESSION = 'a'.repeat(64);
const OPEN: ConsoleOpen = { user: 'demo', pass: 'secret', session: SESSION, codeId: 'c3d4e5f60718293a', columns: 120, rows: 40 };

describe('frames', () => {
    it('the URL carries no parameter', () => {
        expect(consoleUrl({ protocol: 'https:', host: 'box.local' })).toBe('wss://box.local/api/console');
        expect(consoleUrl({ protocol: 'http:', host: 'localhost:4173' })).toBe('ws://localhost:4173/api/console');
    });

    it('the open message carries the credentials, the session and the code id', () => {
        expect(JSON.parse(encodeOpen(OPEN))).toEqual({
            type: 'open',
            cn_user: 'demo',
            cn_pass: 'secret',
            admin_session: SESSION,
            code_id: 'c3d4e5f60718293a',
            columns: 120,
            rows: 40,
            term: 'xterm-256color',
        });
    });

    it('sizes stay integers from 1 to 1000', () => {
        expect(clampSize(0)).toBe(1);
        expect(clampSize(-5)).toBe(1);
        expect(clampSize(5000)).toBe(1000);
        expect(clampSize(80.6)).toBe(81);
        expect(clampSize(Number.NaN)).toBe(1);
        expect(JSON.parse(encodeResize(4000, 0))).toEqual({ type: 'resize', columns: 1000, rows: 1 });
    });

    it('input is split under 64 KiB, never empty, never inside a surrogate pair', () => {
        expect(encodeInput('')).toEqual([]);
        expect(encodeInput('ls\r').map((f) => JSON.parse(f))).toEqual([{ type: 'input', data: 'ls\r' }]);

        const escapes = '\u001b'.repeat(20_000);
        const frames = encodeInput(escapes);
        expect(frames.length).toBeGreaterThan(1);
        for (const frame of frames) expect(new TextEncoder().encode(frame).length).toBeLessThanOrEqual(64 * 1024);
        expect(frames.map((f) => (JSON.parse(f) as { data: string }).data).join('')).toBe(escapes);

        const emoji = 'a'.repeat(8191) + '\u{1F600}';
        const parts = encodeInput(emoji).map((f) => (JSON.parse(f) as { data: string }).data);
        expect(parts[0]).toHaveLength(8191);
        expect(parts[1]).toBe('\u{1F600}');
    });

    it('reads ready and error, ignores the rest', () => {
        expect(parseConsoleText('{"type":"ready","console_id":"4fbd81b12ca13a2b","expires_in":3600,"idle_timeout":900}')).toEqual({
            type: 'ready',
            ready: { consoleId: '4fbd81b12ca13a2b', expiresIn: 3600, idleTimeout: 900 },
        });
        const error = parseConsoleText('{"type":"error","success":"false","error":"console_limit","msg":"x","max":"2"}');
        expect(error?.type === 'error' && error.error.code).toBe('console_limit');
        expect(error?.type === 'error' && error.error.max).toBe(2);
        expect(parseConsoleText('{"type":"output"}')).toBeNull();
        expect(parseConsoleText('not json')).toBeNull();
    });
});

describe('close codes', () => {
    const base: CloseContext = {
        code: 1001,
        ready: true,
        error: null,
        openFor: 100,
        idleFor: 10,
        lifetime: 3600,
        idleTimeout: 900,
    };

    it('maps the documented closes', () => {
        expect(classifyClose({ ...base, code: 1000 })).toEqual({ kind: 'exited' });
        expect(classifyClose({ ...base, openFor: 3600 })).toEqual({ kind: 'expired' });
        expect(classifyClose({ ...base, idleFor: 899 })).toEqual({ kind: 'idle' });
        expect(classifyClose(base)).toEqual({ kind: 'server' });
        expect(classifyClose({ ...base, code: 1009 })).toEqual({ kind: 'too_big' });
        expect(classifyClose({ ...base, code: 1006 })).toEqual({ kind: 'lost' });
    });

    it('a reason from the server decides, whatever the clock says', () => {
        for (const kind of ['closed', 'exited', 'expired', 'idle', 'not_connected', 'shutdown', 'admin_set', 'admin_reset', 'bad_code'] as const) {
            expect(classifyClose({ ...base, reason: kind })).toEqual({ kind });
        }
        expect(classifyClose({ ...base, reason: 'idle', openFor: 3600 })).toEqual({ kind: 'idle' });
        expect(classifyClose({ ...base, code: 1000, reason: 'expired' })).toEqual({ kind: 'expired' });
    });

    it('an empty or unknown reason keeps the clock guess', () => {
        expect(classifyClose({ ...base, reason: '', openFor: 3600 })).toEqual({ kind: 'expired' });
        expect(classifyClose({ ...base, reason: 'console closed', idleFor: 899 })).toEqual({ kind: 'idle' });
        expect(classifyClose({ ...base, reason: 'whatever' })).toEqual({ kind: 'server' });
        expect(classifyClose({ ...base, reason: 'Idle' })).toEqual({ kind: 'server' });
    });

    it('only the three admin reasons end the admin session', () => {
        expect(['admin_set', 'admin_reset', 'bad_code', 'expired', 'idle', 'shutdown', 'closed'].map((kind) => endsAdminSession({ kind } as ConsoleEnd))).toEqual([
            true, true, true, false, false, false, false,
        ]);
    });

    it('a refusal beats the reason', () => {
        const error = parseConsoleText('{"type":"error","success":"false","error":"login_failed","msg":"x"}');
        if (error?.type !== 'error') throw new Error('expected an error');
        expect(classifyClose({ ...base, ready: false, code: 1008, reason: 'bad_code', error: error.error })).toMatchObject({ kind: 'refused' });
    });

    it('before ready: a refusal, or a handshake the browser could not see', () => {
        const error = parseConsoleText('{"type":"error","success":"false","error":"code_expired","msg":"x"}');
        if (error?.type !== 'error') throw new Error('expected an error');
        expect(classifyClose({ ...base, ready: false, code: 1008, error: error.error })).toMatchObject({
            kind: 'refused',
            error: { code: 'code_expired' },
        });
        expect(classifyClose({ ...base, ready: false, code: 1006 })).toEqual({ kind: 'handshake' });
        expect(classifyClose({ ...base, ready: false, code: 1001 })).toEqual({ kind: 'lost' });
    });
});

class FakeSocket {
    static last: FakeSocket;
    readyState = 0;
    binaryType = 'blob';
    sent: (string | Uint8Array)[] = [];
    closedWith: number | null = null;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onclose: ((event: { code: number; reason: string }) => void) | null = null;

    constructor(
        public url: string,
        public protocol: string,
    ) {
        FakeSocket.last = this;
    }

    send(data: string | Uint8Array): void {
        this.sent.push(data);
    }

    close(code: number): void {
        this.closedWith = code;
    }

    open(): void {
        this.readyState = 1;
        this.onopen?.();
    }

    message(data: unknown): void {
        this.onmessage?.({ data });
    }

    end(code: number, reason = ''): void {
        this.readyState = 3;
        this.onclose?.({ code, reason });
    }
}

function connect(): { conn: ConsoleConnection; ws: FakeSocket; events: { ready: ConsoleReady[]; output: string[]; end: ConsoleEnd[] } } {
    const events = { ready: [] as ConsoleReady[], output: [] as string[], end: [] as ConsoleEnd[] };
    const conn = new ConsoleConnection(
        { ...OPEN },
        {
            onReady: (r) => events.ready.push(r),
            onOutput: (b) => events.output.push(new TextDecoder().decode(b)),
            onEnd: (e) => events.end.push(e),
        },
        'wss://box.local/api/console',
        FakeSocket as unknown as new (url: string, protocols: string) => WebSocket,
    );
    return { conn, ws: FakeSocket.last, events };
}

const READY = '{"type":"ready","console_id":"4fbd81b12ca13a2b","expires_in":3600,"idle_timeout":900}';

describe('ConsoleConnection', () => {
    it('opens with the subprotocol and sends the open message first, once', () => {
        const { ws, conn } = connect();
        expect(ws.url).toBe('wss://box.local/api/console');
        expect(ws.protocol).toBe(CONSOLE_PROTOCOL);
        expect(ws.binaryType).toBe('arraybuffer');
        conn.input('early');
        expect(ws.sent).toEqual([]);

        ws.open();
        expect(ws.sent).toHaveLength(1);
        expect(JSON.parse(ws.sent[0] as string)).toMatchObject({ type: 'open', admin_session: SESSION });
        ws.onopen?.();
        expect(ws.sent).toHaveLength(1);
    });

    it('relays output after ready, input and resizes, and closes with 1000', () => {
        const { ws, conn, events } = connect();
        ws.open();
        ws.message(new TextEncoder().encode('before').buffer);
        conn.input('ignored');
        ws.message(READY);
        expect(events.ready).toHaveLength(1);
        expect(conn.isReady).toBe(true);

        ws.message(new TextEncoder().encode('root# ').buffer);
        expect(events.output).toEqual(['root# ']);

        conn.input('ls\r');
        conn.input('');
        conn.resize(2000, 30);
        conn.binary('ÿ\u0001');
        expect(ws.sent.slice(1, 3).map((f) => JSON.parse(f as string))).toEqual([
            { type: 'input', data: 'ls\r' },
            { type: 'resize', columns: 1000, rows: 30 },
        ]);
        expect(Array.from(ws.sent[3] as Uint8Array)).toEqual([0xff, 0x01]);

        conn.close();
        expect(ws.closedWith).toBe(1000);
        expect(events.end).toEqual([]);
    });

    it('an error before ready ends as a refusal', () => {
        const { ws, events } = connect();
        ws.open();
        ws.message('{"type":"error","success":"false","error":"login_failed","msg":"Login failed"}');
        ws.end(1008);
        expect(events.end).toEqual([{ kind: 'refused', error: expect.objectContaining({ code: 'login_failed' }) }]);
    });

    it('a closed socket before open never sends the secrets', () => {
        const { ws, events } = connect();
        ws.end(1006);
        ws.onopen?.();
        expect(ws.sent).toEqual([]);
        expect(events.end).toEqual([{ kind: 'handshake' }]);
    });
});
