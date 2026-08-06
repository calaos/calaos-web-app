// services/calaos.ts — the ONLY place where the websocket and the stores know
// about each other.
//
// The socket (protocol/socket.ts) is framework-free and has no auth logic;
// the stores have no socket. This module owns the three couplings:
//
//   statuschange ─▶ connection store (banner)
//   open         ─▶ auth.resumeSession()   (guarded: creds held, not rejected)
//   message      ─▶ auth / home stores, and the get_home follow-up
//
// It deliberately does NOT listen for 'close': a dropped connection updates
// the banner through statuschange and nothing else. The old app signed the
// user out and navigated to /login on any websocket error.
//
// NO vue-router import: the router lands in T06. Navigation intents are
// raised as auth-store state (`pendingNavigation`, consumed via
// `consumeNavigation()`), which the router will watch.

import { CalaosSocket } from '../protocol/socket';
import { wsUrl } from '../protocol/server-url';
import { encodeGetHome } from '../protocol/messages';
import { useAudioStore } from '../stores/audio';
import { useAuthStore } from '../stores/auth';
import { useConnectionStore } from '../stores/connection';
import { useHomeStore } from '../stores/home';
import type { CalaosSocketListener, SocketStatusInfo } from '../protocol/socket';
import type { ServerMessage } from '../protocol/types';

export interface CalaosService {
    /** Exposed for tests and for the (future) camera/audio code paths. */
    readonly socket: CalaosSocket;
    /** Opens the connection. Idempotent — the socket ignores a second call. */
    start(): void;
    /** Permanent close; start() reopens. */
    stop(): void;
    /** Unsubscribes and closes (tests, HMR). */
    dispose(): void;
}

/**
 * Wires a socket to the stores. The socket is injectable so unit tests can
 * drive a CalaosSocket built on a fake WebSocket; production passes nothing
 * and gets the same-origin ws(s)://host/api URL.
 *
 * Requires an active pinia (the stores are resolved here), so it must be
 * called after `app.use(createPinia())`.
 */
export function createCalaosService(
    socket: CalaosSocket = new CalaosSocket(wsUrl()),
): CalaosService {
    const connection = useConnectionStore();
    const auth = useAuthStore();
    const home = useHomeStore();
    const audio = useAudioStore();

    const sendFrame = (frame: string): boolean => socket.send(frame);
    auth.attachTransport(sendFrame);
    home.attachTransport(sendFrame);
    audio.attachTransport(sendFrame);
    // The home store owns the event dispatch table; the audio state it would
    // otherwise have to carry lives in its own store, so the three audio
    // event types are routed across here rather than by a store-to-store
    // import (see stores/home.ts AUDIO_EVENT_TYPES).
    home.attachAudioEvents(audio.handleAudioEvent);

    const onStatusChange = (info: SocketStatusInfo): void => {
        connection.applyStatus(info);
    };

    // Fires for the first connect AND for every reconnect. resumeSession()
    // self-guards, so a cold load with no credentials sends nothing, while a
    // sign-in typed before the socket was open still goes out here.
    const onOpen: CalaosSocketListener<'open'> = () => {
        auth.resumeSession();
    };

    const onMessage = (msg: ServerMessage): void => {
        switch (msg.kind) {
            case 'login':
                auth.handleLoginResult(msg.success);
                // Old parseMessage did exactly this: authenticate, then ask
                // for the whole house.
                if (msg.success) socket.send(encodeGetHome());
                break;

            case 'get_home':
                home.setHome(msg.home);
                // The audio section's detail is NOT in this frame: upstream
                // keeps status/volume/track out of get_home so the house is
                // not delayed by round trips to the media server
                // (docs/audio-protocol.md). It takes a get_state to learn any
                // of it — ONE frame for every player, issued here rather than
                // from the list view so the section is already warm when the
                // Audio tab is first pressed, and re-issued after every
                // reconnect because get_home is what a reconnect replays.
                audio.clear();
                audio.requestDetails(msg.home.audio.map((player) => player.id));
                // Raises the 'home' navigation intent for interactive
                // sign-ins only — and with no artificial delay (the old app
                // waited 1.5 s here to let the login animation play).
                auth.notifyHomeLoaded();
                break;

            case 'get_state':
                audio.applyGetState(msg);
                break;

            case 'audio_query':
                audio.applyAudioQuery(msg);
                break;

            case 'io_changed':
            case 'unknown_event':
                home.handleEvent(msg);
                break;

            case 'unknown':
                // decodeServerMessage already warned; nothing to do.
                break;
        }
    };

    socket.on('statuschange', onStatusChange);
    socket.on('open', onOpen);
    socket.on('message', onMessage);

    return {
        socket,
        start(): void {
            socket.connect();
        },
        stop(): void {
            socket.close();
        },
        dispose(): void {
            socket.off('statuschange', onStatusChange);
            socket.off('open', onOpen);
            socket.off('message', onMessage);
            socket.close();
        },
    };
}

let instance: CalaosService | null = null;

/**
 * Lazily-created singleton — the app's entry point into the protocol layer.
 * T06 calls `getCalaosService().start()` once the app is mounted (pinia must
 * be installed first); views and composables only ever touch the stores.
 */
export function getCalaosService(): CalaosService {
    if (instance === null) instance = createCalaosService();
    return instance;
}

/** Tears the singleton down. Tests and HMR only. */
export function resetCalaosService(): void {
    if (instance === null) return;
    instance.dispose();
    instance = null;
}
