// The web console's WebSocket, `/api/console` (calaos_base docs/08_http_api.md,
// "Console web"). NO Vue imports.
//
// Everything that authenticates goes in the first message, never in the URL:
// haproxy logs URLs. The open message is built at `open` and dropped once
// sent, so neither the session nor the code id outlives it here.

import { isRecord } from './guards';
import { toAdminError } from './admin';
import type { AdminError } from './admin';
import type { UrlLocation } from './server-url';

export const CONSOLE_PROTOCOL = 'calaos-console.v1';
export const CONSOLE_TERM = 'xterm-256color';
/** Columns and rows the server accepts. */
export const CONSOLE_SIZE_MIN = 1;
export const CONSOLE_SIZE_MAX = 1000;
/**
 * A message over 64 KiB closes the console. JSON escaping takes at most six
 * bytes per UTF-16 unit (`\u001b`), so 8 Ki units stay under it with room
 * for the envelope.
 */
export const CONSOLE_INPUT_CHUNK = 8192;
/** The daemon's defaults, used when `ready` omits them. */
export const CONSOLE_LIFETIME_S = 3600;
export const CONSOLE_IDLE_S = 900;

export function consoleUrl(loc: UrlLocation = location): string {
    const scheme = loc.protocol === 'https:' ? 'wss://' : 'ws://';
    return `${scheme}${loc.host}/api/console`;
}

export function clampSize(value: number): number {
    if (!Number.isFinite(value)) return CONSOLE_SIZE_MIN;
    return Math.min(CONSOLE_SIZE_MAX, Math.max(CONSOLE_SIZE_MIN, Math.round(value)));
}

export interface ConsoleOpen {
    user: string;
    pass: string;
    session: string;
    codeId: string;
    columns: number;
    rows: number;
}

export function encodeOpen(open: ConsoleOpen): string {
    return JSON.stringify({
        type: 'open',
        cn_user: open.user,
        cn_pass: open.pass,
        admin_session: open.session,
        code_id: open.codeId,
        columns: clampSize(open.columns),
        rows: clampSize(open.rows),
        term: CONSOLE_TERM,
    });
}

export function encodeResize(columns: number, rows: number): string {
    return JSON.stringify({ type: 'resize', columns: clampSize(columns), rows: clampSize(rows) });
}

/** Input frames, each under the size limit; never an empty one (it closes the socket). */
export function encodeInput(text: string): string[] {
    const frames: string[] = [];
    let start = 0;
    while (start < text.length) {
        let end = Math.min(text.length, start + CONSOLE_INPUT_CHUNK);
        // Do not split a surrogate pair across two frames.
        const last = text.charCodeAt(end - 1);
        if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
        frames.push(JSON.stringify({ type: 'input', data: text.slice(start, end) }));
        start = end;
    }
    return frames;
}

export interface ConsoleReady {
    consoleId: string;
    expiresIn: number;
    idleTimeout: number;
}

export type ConsoleFrame = { type: 'ready'; ready: ConsoleReady } | { type: 'error'; error: AdminError } | null;

function positive(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** The two text messages the server sends; anything else is null. */
export function parseConsoleText(raw: string): ConsoleFrame {
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!isRecord(data)) return null;
    if (data.type === 'ready') {
        return {
            type: 'ready',
            ready: {
                consoleId: typeof data.console_id === 'string' ? data.console_id : '',
                expiresIn: positive(data.expires_in, CONSOLE_LIFETIME_S),
                idleTimeout: positive(data.idle_timeout, CONSOLE_IDLE_S),
            },
        };
    }
    if (data.type === 'error') return { type: 'error', error: toAdminError(data) };
    return null;
}

/**
 * Why a console ended, for the user. The server names the reason in the close
 * frame; an older one sends none and closes 1001 for every deadline alike,
 * so the hour and the idle delay are then told apart by the clock.
 */
export type ConsoleEnd =
    | { kind: 'refused'; error: AdminError }
    /** The upgrade itself was refused (plain http, Origin): the browser only sees 1006. */
    | { kind: 'handshake' }
    | { kind: 'exited' }
    | { kind: 'expired' }
    | { kind: 'idle' }
    | { kind: 'server' }
    | { kind: 'closed' }
    | { kind: 'not_connected' }
    | { kind: 'shutdown' }
    /** The admin password changed or was reset, or five codes were wrong: the admin session is gone. */
    | { kind: 'admin_set' }
    | { kind: 'admin_reset' }
    | { kind: 'bad_code' }
    | { kind: 'too_big' }
    | { kind: 'lost' }
    /** Closed from this page. */
    | { kind: 'user' }
    /** The xterm.js chunk did not load. */
    | { kind: 'load_failed' };

/** The close reasons of calaos_server that stand for a whole end. */
const REASON_KINDS = [
    'closed',
    'exited',
    'expired',
    'idle',
    'not_connected',
    'shutdown',
    'admin_set',
    'admin_reset',
    'bad_code',
] as const;
type ReasonKind = (typeof REASON_KINDS)[number];

function isReasonKind(reason: string): reason is ReasonKind {
    return (REASON_KINDS as readonly string[]).includes(reason);
}

/** The end kinds after which the admin session no longer exists. */
export function endsAdminSession(end: ConsoleEnd): boolean {
    return end.kind === 'admin_set' || end.kind === 'admin_reset' || end.kind === 'bad_code';
}

export interface CloseContext {
    code: number;
    /** The close frame's reason text; empty from an older server. */
    reason?: string;
    /** `ready` was received. */
    ready: boolean;
    /** The server's error message before the close, if any. */
    error: AdminError | null;
    /** Seconds since `ready`. */
    openFor: number;
    /** Seconds since the last input. */
    idleFor: number;
    lifetime: number;
    idleTimeout: number;
}

/** A close this close to a deadline is that deadline: timers on both sides drift. */
const DEADLINE_SLACK_S = 5;

export function classifyClose(ctx: CloseContext): ConsoleEnd {
    if (ctx.error !== null) return { kind: 'refused', error: ctx.error };
    const reason = ctx.reason ?? '';
    if (isReasonKind(reason)) return { kind: reason };
    if (!ctx.ready) return ctx.code === 1006 ? { kind: 'handshake' } : { kind: 'lost' };
    switch (ctx.code) {
        case 1000:
            return { kind: 'exited' };
        case 1001:
            if (ctx.openFor >= ctx.lifetime - DEADLINE_SLACK_S) return { kind: 'expired' };
            if (ctx.idleFor >= ctx.idleTimeout - DEADLINE_SLACK_S) return { kind: 'idle' };
            return { kind: 'server' };
        case 1009:
            return { kind: 'too_big' };
        default:
            return { kind: 'lost' };
    }
}

export interface ConsoleHandlers {
    onReady(ready: ConsoleReady): void;
    onOutput(bytes: Uint8Array): void;
    onEnd(end: ConsoleEnd): void;
}

/** `WebSocket.OPEN`, without needing the global (tests inject a fake). */
const OPEN = 1;

type SocketCtor = new (url: string, protocols: string) => WebSocket;

/** One console: one socket, never reopened (a new console needs a new code). */
export class ConsoleConnection {
    private ws: WebSocket | null;
    private ready: ConsoleReady | null = null;
    private error: AdminError | null = null;
    private readyAt = 0;
    private lastInputAt = 0;
    private ended = false;

    constructor(
        open: ConsoleOpen,
        private readonly handlers: ConsoleHandlers,
        url: string = consoleUrl(),
        Socket: SocketCtor = WebSocket,
        private readonly now: () => number = Date.now,
    ) {
        let pending: ConsoleOpen | null = open;
        const ws = new Socket(url, CONSOLE_PROTOCOL);
        ws.binaryType = 'arraybuffer';
        ws.onopen = () => {
            if (pending === null) return;
            ws.send(encodeOpen(pending));
            pending = null;
        };
        ws.onmessage = (event: MessageEvent) => this.receive(event.data);
        ws.onclose = (event: CloseEvent) => {
            pending = null;
            this.finish(event.code, event.reason);
        };
        this.ws = ws;
    }

    get isReady(): boolean {
        return this.ready !== null && !this.ended;
    }

    private receive(data: unknown): void {
        if (typeof data === 'string') {
            const frame = parseConsoleText(data);
            if (frame?.type === 'ready' && this.ready === null) {
                this.ready = frame.ready;
                this.readyAt = this.now();
                this.lastInputAt = this.readyAt;
                this.handlers.onReady(frame.ready);
            } else if (frame?.type === 'error' && this.ready === null) {
                this.error = frame.error;
            }
            return;
        }
        if (this.ready === null) return;
        if (data instanceof ArrayBuffer) this.handlers.onOutput(new Uint8Array(data));
    }

    private finish(code: number, reason: string | undefined): void {
        if (this.ended) return;
        this.ended = true;
        this.ws = null;
        const now = this.now();
        this.handlers.onEnd(
            classifyClose({
                code,
                reason,
                ready: this.ready !== null,
                error: this.error,
                openFor: (now - this.readyAt) / 1000,
                idleFor: (now - this.lastInputAt) / 1000,
                lifetime: this.ready?.expiresIn ?? CONSOLE_LIFETIME_S,
                idleTimeout: this.ready?.idleTimeout ?? CONSOLE_IDLE_S,
            }),
        );
    }

    private sendable(): WebSocket | null {
        const ws = this.ws;
        if (ws === null || this.ready === null || ws.readyState !== OPEN) return null;
        return ws;
    }

    /** xterm's `onData`. */
    input(text: string): void {
        const ws = this.sendable();
        if (ws === null || text === '') return;
        for (const frame of encodeInput(text)) ws.send(frame);
        this.lastInputAt = this.now();
    }

    /** xterm's `onBinary`: one byte per character. */
    binary(text: string): void {
        const ws = this.sendable();
        if (ws === null || text === '') return;
        const bytes = new Uint8Array(text.length);
        for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
        for (let i = 0; i < bytes.length; i += CONSOLE_INPUT_CHUNK) ws.send(bytes.subarray(i, i + CONSOLE_INPUT_CHUNK));
        this.lastInputAt = this.now();
    }

    resize(columns: number, rows: number): void {
        this.sendable()?.send(encodeResize(columns, rows));
    }

    /** Leaving the page: the server passes 1000 on to the daemon, which ends the shell. */
    close(): void {
        const ws = this.ws;
        if (ws === null) return;
        this.ended = true;
        this.ws = null;
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.close(1000);
    }
}
