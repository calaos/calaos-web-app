// Framework-free reconnecting websocket client.
//
// NO Vue imports in this directory, and deliberately NO auth logic, NO store
// access and NO navigation: login-on-open lives in services/calaos.ts and
// only fires when the auth store holds credentials (see docs/ARCHITECTURE.md
// "WS client"). That separation kills two old bugs — empty-credential
// auto-login on page load, and sign-out-on-ws-error.
//
// Reconnect behaviour matches the defaults of the old vendored
// reconnecting-websocket.js (src/scripts/reconnecting-websocket.js):
// 1000 ms base delay, ×1.5 per failed attempt, capped at 30 000 ms, 2 s
// connect timeout, infinite retry.

import { decodeServerMessage } from './messages';
import type { ServerMessage } from './types';

/** Delay before the first retry (old `reconnectInterval`). */
export const RECONNECT_INTERVAL_MS = 1000;
/** Delay multiplier applied per failed attempt (old `reconnectDecay`). */
export const RECONNECT_DECAY = 1.5;
/** Upper bound on the retry delay (old `maxReconnectInterval`). */
export const MAX_RECONNECT_INTERVAL_MS = 30000;
/**
 * A connect attempt that has not opened within this delay is force-closed and
 * retried (old `timeoutInterval`). Without it a connect that stalls — captive
 * portal, dead TCP path — never fires `close` and the client hangs forever.
 */
export const CONNECT_TIMEOUT_MS = 2000;

/** Close code used for failures the socket itself decides (timeout, error). */
const CLOSE_ABNORMAL = 1006;

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting';

export interface SocketOpenInfo {
    /** false only for the very first attempt of this socket's life. */
    isReconnect: boolean;
}

export interface SocketCloseInfo {
    code: number;
    reason: string;
    wasClean: boolean;
}

export interface SocketStatusInfo {
    status: ConnectionStatus;
    /** Consecutive failed attempts since the last successful open (0 while open). */
    attempt: number;
    /** ms until the next attempt; 0 unless status is 'reconnecting'. */
    nextRetryMs: number;
}

export interface CalaosSocketEventMap {
    // Fires on every successful connect, including reconnects.
    open: SocketOpenInfo;
    // Fires ONLY for a socket that had reached 'open' — i.e. `close` pairs
    // with `open`. A connect attempt that never opened (timeout, refused)
    // reports itself through `statuschange` alone, so a long reconnect loop
    // does not spam `close`.
    close: SocketCloseInfo;
    // Decoded frame. decodeServerMessage never throws: malformed input is
    // EMITTED as { kind: 'unknown', raw } rather than dropped, so consumers
    // can log it; the socket itself is unaffected.
    message: ServerMessage;
    // Fires at every transition point, including repeats of the same status
    // string with a new `attempt` / `nextRetryMs` (each failed retry emits
    // 'reconnecting' again). Drives the connection store / banner.
    statuschange: SocketStatusInfo;
}

export type CalaosSocketEvent = keyof CalaosSocketEventMap;

export type CalaosSocketListener<E extends CalaosSocketEvent> = (
    payload: CalaosSocketEventMap[E],
) => void;

export interface CalaosSocketOptions {
    /** Injected by tests (and only by tests); defaults to the global WebSocket. */
    WebSocketCtor?: typeof WebSocket;
}

/**
 * Delay before the retry that follows `attempt` consecutive failures:
 * `min(1000 × 1.5^attempt, 30000)` — 1000, 1500, 2250, 3375, … , 30000.
 * `attempt` is 0-based, so the first retry waits the base interval, exactly
 * like the old client (which read `reconnectAttempts` before incrementing it).
 */
export function reconnectDelay(attempt: number): number {
    return Math.min(
        RECONNECT_INTERVAL_MS * Math.pow(RECONNECT_DECAY, attempt),
        MAX_RECONNECT_INTERVAL_MS,
    );
}

export class CalaosSocket {
    readonly url: string;

    private readonly WebSocketCtor: typeof WebSocket;
    private ws: WebSocket | null = null;
    private currentStatus: ConnectionStatus = 'connecting';
    private failures = 0;
    private pendingRetryMs = 0;
    private stopped = false;
    private connectTimer: ReturnType<typeof setTimeout> | null = null;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;

    private readonly listeners: { [E in CalaosSocketEvent]: Set<CalaosSocketListener<E>> } = {
        open: new Set(),
        close: new Set(),
        message: new Set(),
        statuschange: new Set(),
    };

    // Does NOT connect on construction (the old client's automaticOpen did):
    // callers register listeners first, then call connect(), so the initial
    // 'connecting' statuschange is never missed.
    constructor(url: string, options: CalaosSocketOptions = {}) {
        this.url = url;
        this.WebSocketCtor = options.WebSocketCtor ?? WebSocket;
    }

    get status(): ConnectionStatus {
        return this.currentStatus;
    }

    /** Consecutive failed attempts since the last successful open. */
    get attempt(): number {
        return this.failures;
    }

    /** ms until the next attempt; 0 unless a retry is pending. */
    get nextRetryMs(): number {
        return this.pendingRetryMs;
    }

    get isOpen(): boolean {
        return this.currentStatus === 'open' && this.ws !== null;
    }

    on<E extends CalaosSocketEvent>(event: E, listener: CalaosSocketListener<E>): void {
        this.listeners[event].add(listener);
    }

    off<E extends CalaosSocketEvent>(event: E, listener: CalaosSocketListener<E>): void {
        this.listeners[event].delete(listener);
    }

    /** Idempotent: a second call while connecting/open/retrying does nothing. */
    connect(): void {
        this.stopped = false;
        if (this.ws !== null || this.retryTimer !== null) return;
        this.setStatus(this.failures === 0 ? 'connecting' : 'reconnecting', 0);
        this.openSocket();
    }

    /**
     * Permanent close: cancels the pending retry and stops the reconnect loop
     * (connect() restarts it). Status keeps its last value — the three-state
     * union is what the connection banner consumes and has no 'closed' member.
     */
    close(code = 1000, reason = ''): void {
        this.stopped = true;
        this.clearConnectTimer();
        if (this.retryTimer !== null) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
        this.pendingRetryMs = 0;

        const socket = this.ws;
        this.ws = null;
        if (socket !== null) {
            this.detach(socket);
            this.closeQuietly(socket, code, reason);
        }
        if (this.currentStatus === 'open') {
            this.emit('close', { code, reason, wasClean: true });
        }
    }

    /**
     * Sends a pre-encoded frame (see messages.ts encoders). Returns false when
     * the socket is not open: the frame is DROPPED, not queued. The old client
     * threw 'INVALID_STATE_ERR' here and no caller caught it; queueing would
     * replay stale commands after a long outage, which is worse than losing
     * them — the user can press the button again.
     */
    send(frame: string): boolean {
        if (this.ws === null || this.currentStatus !== 'open') {
            console.warn('calaos socket: dropping frame, socket not open:', frame);
            return false;
        }
        try {
            this.ws.send(frame);
            return true;
        } catch (err) {
            console.warn('calaos socket: send failed:', err);
            return false;
        }
    }

    // -----------------------------------------------------------------------
    // internals
    // -----------------------------------------------------------------------

    private openSocket(): void {
        const socket = new this.WebSocketCtor(this.url);
        this.ws = socket;

        // Every handler checks socket identity: a stale socket (already
        // replaced by a retry) must never drive the state machine again.
        socket.onopen = () => {
            if (this.ws !== socket) return;
            this.clearConnectTimer();
            const isReconnect = this.failures > 0;
            this.failures = 0;
            this.setStatus('open', 0);
            this.emit('open', { isReconnect });
        };

        socket.onmessage = (ev: MessageEvent) => {
            if (this.ws !== socket) return;
            this.emit('message', decodeServerMessage(ev?.data));
        };

        socket.onerror = () => {
            if (this.ws !== socket) return;
            // Browsers always follow an error with a close event, but a mock
            // or a half-open socket may not — treat it as terminal here so the
            // retry loop can never stall.
            this.failAttempt(socket, {
                code: CLOSE_ABNORMAL,
                reason: 'error',
                wasClean: false,
            });
        };

        socket.onclose = (ev: CloseEvent) => {
            if (this.ws !== socket) return;
            this.failAttempt(socket, {
                code: typeof ev?.code === 'number' ? ev.code : CLOSE_ABNORMAL,
                reason: typeof ev?.reason === 'string' ? ev.reason : '',
                wasClean: ev?.wasClean === true,
            });
        };

        this.connectTimer = setTimeout(() => {
            this.connectTimer = null;
            if (this.ws !== socket) return;
            this.failAttempt(socket, {
                code: CLOSE_ABNORMAL,
                reason: 'connect timeout',
                wasClean: false,
            });
        }, CONNECT_TIMEOUT_MS);
    }

    private failAttempt(socket: WebSocket, info: SocketCloseInfo): void {
        this.clearConnectTimer();
        this.detach(socket);
        this.ws = null;
        // Covers the timeout path (socket still CONNECTING); close() on an
        // already-closed socket is a no-op per spec.
        this.closeQuietly(socket, 1000, '');

        if (this.currentStatus === 'open') this.emit('close', info);
        if (this.stopped) return;
        this.scheduleRetry();
    }

    private scheduleRetry(): void {
        const delay = reconnectDelay(this.failures);
        this.failures += 1;
        this.setStatus('reconnecting', delay);
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            if (this.stopped) return;
            this.openSocket();
        }, delay);
    }

    private setStatus(status: ConnectionStatus, nextRetryMs: number): void {
        this.currentStatus = status;
        this.pendingRetryMs = nextRetryMs;
        this.emit('statuschange', { status, attempt: this.failures, nextRetryMs });
    }

    private clearConnectTimer(): void {
        if (this.connectTimer !== null) {
            clearTimeout(this.connectTimer);
            this.connectTimer = null;
        }
    }

    private detach(socket: WebSocket): void {
        socket.onopen = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
    }

    private closeQuietly(socket: WebSocket, code: number, reason: string): void {
        try {
            socket.close(code, reason);
        } catch {
            // A socket in an unexpected state must never break the retry loop.
        }
    }

    private emit<E extends CalaosSocketEvent>(event: E, payload: CalaosSocketEventMap[E]): void {
        // Copy first: a listener may off() itself while being notified.
        for (const listener of [...this.listeners[event]]) listener(payload);
    }
}
