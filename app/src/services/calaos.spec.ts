import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createCalaosService, getCalaosService, resetCalaosService } from './calaos';
import { CalaosSocket } from '../protocol/socket';
import { useAudioStore } from '../stores/audio';
import { useAuthStore } from '../stores/auth';
import { useConnectionStore } from '../stores/connection';
import { useHomeStore } from '../stores/home';
import type { CalaosService } from './calaos';

// ---------------------------------------------------------------------------
// Same shape of test double as protocol/socket.spec.ts: only the members
// CalaosSocket touches. The service is driven through a REAL CalaosSocket so
// the reconnect/statuschange plumbing is exercised end to end.
// ---------------------------------------------------------------------------

class FakeWebSocket {
    static instances: FakeWebSocket[] = [];

    static get last(): FakeWebSocket {
        const socket = FakeWebSocket.instances.at(-1);
        if (!socket) throw new Error('no FakeWebSocket was constructed');
        return socket;
    }

    readonly sent: string[] = [];
    onopen: ((ev: unknown) => void) | null = null;
    onclose: ((ev: unknown) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    onmessage: ((ev: unknown) => void) | null = null;

    constructor(public readonly url: string) {
        FakeWebSocket.instances.push(this);
    }

    send(data: string): void {
        this.sent.push(data);
    }

    close(): void {}

    fireOpen(): void {
        this.onopen?.({});
    }

    fireMessage(data: unknown): void {
        this.onmessage?.({ data });
    }

    fireClose(code = 1006): void {
        this.onclose?.({ code, reason: '', wasClean: false });
    }
}

const FakeCtor = FakeWebSocket as unknown as typeof WebSocket;

const LOGIN_OK = '{"msg":"login","data":{"success":"true"}}';
const LOGIN_KO = '{"msg":"login","data":{"success":"false"}}';
const GET_HOME_FRAME = '{"msg":"get_home"}';
const LOGIN_FRAME = '{"msg":"login","data":{"cn_user":"demo","cn_pass":"demo"}}';

const HOME_FRAME = JSON.stringify({
    msg: 'get_home',
    data: {
        home: [
            {
                name: 'Salon',
                type: 'lounge',
                hits: '12',
                items: [
                    {
                        id: 'light_1',
                        name: 'Plafonnier',
                        gui_type: 'light',
                        state: 'false',
                        visible: 'true',
                        rw: 'true',
                        unit: '',
                    },
                ],
            },
            { name: 'Cuisine', type: 'kitchen', hits: '47', items: [] },
        ],
        cameras: [{ id: 'camera_1', name: 'Entrée' }],
        audio: [],
    },
});

let service: CalaosService;

/** Frames written to the wire by the currently-open fake socket. */
function sent(): string[] {
    return FakeWebSocket.last.sent;
}

function startAndOpen(): void {
    service.start();
    FakeWebSocket.last.fireOpen();
}

/** Full happy path: user signs in, server accepts, house data arrives. */
function signInAndLoad(): void {
    useAuthStore().signIn('demo', 'demo');
    FakeWebSocket.last.fireMessage(LOGIN_OK);
    FakeWebSocket.last.fireMessage(HOME_FRAME);
}

beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    FakeWebSocket.instances = [];
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    service = createCalaosService(
        new CalaosSocket('ws://calaos.local/api', { WebSocketCtor: FakeCtor }),
    );
});

afterEach(() => {
    service.dispose();
    resetCalaosService();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('cold start', () => {
    it('does not connect until start() is called', () => {
        expect(FakeWebSocket.instances).toHaveLength(0);
    });

    // The old ws.onopen always sent {cn_user:'',cn_pass:''}; the server
    // rejected it and the login form shook on every page load.
    it('sends ZERO frames when the socket opens without credentials', () => {
        startAndOpen();

        expect(sent()).toEqual([]);
        expect(useAuthStore().state).toBe('idle');
    });

    it('sends ZERO frames across a whole reconnect storm', () => {
        service.start();
        for (let i = 0; i < 5; i += 1) {
            FakeWebSocket.last.fireClose();
            vi.advanceTimersByTime(30000);
            FakeWebSocket.last.fireOpen();
        }

        expect(FakeWebSocket.instances.every((ws) => ws.sent.length === 0)).toBe(true);
    });
});

describe('sign-in flow', () => {
    it('login → get_home → home store + /home navigation intent', () => {
        const auth = useAuthStore();
        const home = useHomeStore();
        startAndOpen();

        expect(auth.signIn('demo', 'demo')).toBe(true);
        expect(sent()).toEqual([LOGIN_FRAME]);

        FakeWebSocket.last.fireMessage(LOGIN_OK);
        expect(auth.state).toBe('authed');
        expect(sent()).toEqual([LOGIN_FRAME, GET_HOME_FRAME]);
        expect(auth.pendingNavigation).toBeNull();

        FakeWebSocket.last.fireMessage(HOME_FRAME);
        expect(home.loaded).toBe(true);
        expect(home.rooms.map((room) => room.name)).toEqual(['Cuisine', 'Salon']);
        expect(home.getIo('light_1')?.name).toBe('Plafonnier');
        expect(home.cameras).toHaveLength(1);
        expect(auth.pendingNavigation).toBe('home');
    });

    it('rejects without asking for the house', () => {
        const auth = useAuthStore();
        startAndOpen();
        auth.signIn('demo', 'nope');

        FakeWebSocket.last.fireMessage(LOGIN_KO);

        expect(auth.state).toBe('failed');
        expect(sent()).toEqual(['{"msg":"login","data":{"cn_user":"demo","cn_pass":"nope"}}']);
        expect(auth.pendingNavigation).toBeNull();
        expect(useHomeStore().loaded).toBe(false);
    });

    it('flushes a sign-in submitted before the socket was open', () => {
        const auth = useAuthStore();
        service.start();

        // Socket still connecting: the frame is dropped, not queued.
        expect(auth.signIn('demo', 'demo')).toBe(false);
        expect(sent()).toEqual([]);

        FakeWebSocket.last.fireOpen();
        expect(sent()).toEqual([LOGIN_FRAME]);
        expect(auth.state).toBe('pending');
    });
});

describe('reconnect', () => {
    it('re-logs in with the retained credentials and does not navigate', () => {
        const auth = useAuthStore();
        const home = useHomeStore();
        startAndOpen();
        signInAndLoad();
        auth.consumeNavigation();

        FakeWebSocket.last.fireClose();
        // A dropped socket must NOT sign the user out (old ws.onerror did).
        expect(auth.state).toBe('authed');
        expect(auth.isAuthed).toBe(true);
        expect(home.loaded).toBe(true);
        expect(home.ios.size).toBe(1);

        vi.advanceTimersByTime(1000);
        FakeWebSocket.last.fireOpen();

        expect(sent()).toEqual([LOGIN_FRAME]);
        FakeWebSocket.last.fireMessage(LOGIN_OK);
        FakeWebSocket.last.fireMessage(HOME_FRAME);

        expect(auth.state).toBe('authed');
        // The user stays where they were — no /home push behind their back.
        expect(auth.pendingNavigation).toBeNull();
    });

    it('never re-logs in after the server rejected the credentials', () => {
        const auth = useAuthStore();
        startAndOpen();
        auth.signIn('demo', 'nope');
        FakeWebSocket.last.fireMessage(LOGIN_KO);

        for (let i = 0; i < 3; i += 1) {
            FakeWebSocket.last.fireClose();
            vi.advanceTimersByTime(30000);
            FakeWebSocket.last.fireOpen();
            expect(sent()).toEqual([]);
        }
        expect(auth.state).toBe('failed');
    });

    it('signs back in after signOut without touching the socket', () => {
        const auth = useAuthStore();
        startAndOpen();
        signInAndLoad();
        const socketBefore = FakeWebSocket.last;

        auth.signOut();

        expect(auth.pendingNavigation).toBe('login');
        expect(useHomeStore().ios.size).toBe(0);
        // Same socket, still open: signing out is not a network event.
        expect(FakeWebSocket.instances).toHaveLength(1);
        expect(service.socket.isOpen).toBe(true);

        auth.signIn('demo', 'demo');
        expect(socketBefore.sent.at(-1)).toBe(LOGIN_FRAME);
    });
});

describe('events and set_state', () => {
    it('routes io_changed into the home store', () => {
        const home = useHomeStore();
        startAndOpen();
        signInAndLoad();

        FakeWebSocket.last.fireMessage(
            '{"msg":"event","data":{"type_str":"io_changed","data":{"id":"light_1","state":"true"}}}',
        );

        expect(home.getIo('light_1')?.state).toBe('true');
    });

    it('routes unimplemented events to the dispatch-table stub', () => {
        startAndOpen();
        signInAndLoad();

        expect(() =>
            FakeWebSocket.last.fireMessage(
                '{"msg":"event","data":{"type_str":"new_io","data":{"id":"x"}}}',
            ),
        ).not.toThrow();
        expect(console.debug).toHaveBeenCalledWith(
            'calaos home: event "new_io" not implemented yet',
            { id: 'x' },
        );
    });

    it('survives malformed frames', () => {
        const home = useHomeStore();
        startAndOpen();
        signInAndLoad();

        expect(() => FakeWebSocket.last.fireMessage('not json')).not.toThrow();
        expect(() => FakeWebSocket.last.fireMessage('{"msg":"whatever"}')).not.toThrow();
        expect(home.getIo('light_1')?.state).toBe('false');
    });

    it('writes set_state frames from the home store onto the wire', () => {
        const home = useHomeStore();
        startAndOpen();
        signInAndLoad();

        expect(home.sendSetState('light_1', 'true')).toBe(true);

        expect(sent().at(-1)).toBe('{"msg":"set_state","data":{"id":"light_1","value":"true"}}');
        expect(home.isPending('light_1')).toBe(true);

        FakeWebSocket.last.fireMessage(
            '{"msg":"event","data":{"type_str":"io_changed","data":{"id":"light_1","state":"true"}}}',
        );
        expect(home.isPending('light_1')).toBe(false);
    });

    it('drops a set_state sent while the socket is down (no pending badge)', () => {
        const home = useHomeStore();
        startAndOpen();
        signInAndLoad();
        FakeWebSocket.last.fireClose();

        expect(home.sendSetState('light_1', 'true')).toBe(false);
        expect(home.isPending('light_1')).toBe(false);
    });
});

describe('connection store feed', () => {
    it('mirrors the socket status and debounces the banner', () => {
        const connection = useConnectionStore();
        service.start();
        expect(connection.status).toBe('connecting');

        FakeWebSocket.last.fireOpen();
        expect(connection.status).toBe('open');
        expect(connection.isOpen).toBe(true);
        expect(connection.showBanner).toBe(false);

        FakeWebSocket.last.fireClose();
        expect(connection.status).toBe('reconnecting');
        expect(connection.attempt).toBe(1);
        expect(connection.nextRetryMs).toBe(1000);
        expect(connection.showBanner).toBe(false);

        // Retry #1 fails too (2 s connect timeout), banner is up by then.
        vi.advanceTimersByTime(1000);
        expect(connection.showBanner).toBe(true);
        vi.advanceTimersByTime(2000);
        expect(connection.attempt).toBe(2);

        vi.advanceTimersByTime(1500);
        FakeWebSocket.last.fireOpen();
        expect(connection.status).toBe('open');
        expect(connection.attempt).toBe(0);
        expect(connection.showBanner).toBe(false);
    });
});

describe('lifecycle', () => {
    it('dispose() unsubscribes the stores from the socket', () => {
        const connection = useConnectionStore();
        const home = useHomeStore();
        startAndOpen();
        signInAndLoad();
        const socket = FakeWebSocket.last;

        service.dispose();
        connection.reset();

        socket.fireMessage(
            '{"msg":"event","data":{"type_str":"io_changed","data":{"id":"light_1","state":"true"}}}',
        );
        expect(home.getIo('light_1')?.state).toBe('false');
        expect(connection.status).toBe('connecting');
    });

    it('getCalaosService is a lazily-created singleton', () => {
        const first = getCalaosService();
        expect(getCalaosService()).toBe(first);
        // Nothing on the network: CalaosSocket only connects on start().
        expect(FakeWebSocket.instances).toHaveLength(0);

        resetCalaosService();
        expect(getCalaosService()).not.toBe(first);
    });
});

// ---------------------------------------------------------------------------
// audio (docs/audio-protocol.md)
// ---------------------------------------------------------------------------

/** A house with two players, so the batching is visible in the frame log. */
const HOME_WITH_AUDIO = JSON.stringify({
    msg: 'get_home',
    data: {
        home: [],
        cameras: [],
        audio: [
            { id: 'audio_1', name: 'Salon', type: 'slim', playlist: 'true', database: 'true' },
            { id: 'audio_2', name: 'Cuisine', type: 'Roon', playlist: 'true', database: 'false' },
        ],
    },
});

function signInAndLoadAudio(): void {
    useAuthStore().signIn('demo', 'demo');
    FakeWebSocket.last.fireMessage(LOGIN_OK);
    FakeWebSocket.last.fireMessage(HOME_WITH_AUDIO);
}

describe('audio detail follow-up', () => {
    // get_home carries no status/volume/track for a player — upstream keeps
    // them out so the house is not delayed by the media server. Learning any
    // of it takes a get_state, and this is where it is issued.
    it('asks for every player in ONE get_state right after the house lands', () => {
        startAndOpen();
        signInAndLoadAudio();

        expect(sent()).toEqual([
            LOGIN_FRAME,
            GET_HOME_FRAME,
            '{"msg":"get_state","data":{"items":["audio_1","audio_2"]}}',
        ]);
    });

    it('asks for nothing when the house has no player at all', () => {
        startAndOpen();
        signInAndLoad();

        expect(sent().filter((frame) => frame.includes('get_state'))).toEqual([]);
    });

    it('files the answer under the players it names', () => {
        startAndOpen();
        signInAndLoadAudio();

        FakeWebSocket.last.fireMessage(
            JSON.stringify({
                msg: 'get_state',
                data: {
                    audio_1: {
                        status: 'playing',
                        volume: '35',
                        current_track: { title: 'Sunrise' },
                    },
                },
            }),
        );

        const audio = useAudioStore();
        expect(audio.stateFor('audio_1').status).toBe('playing');
        expect(audio.stateFor('audio_1').volume).toBe(35);
        expect(audio.stateFor('audio_1').track.title).toBe('Sunrise');
    });

    it('files a cover answer against the request it echoes', () => {
        startAndOpen();
        signInAndLoadAudio();
        FakeWebSocket.last.fireMessage(
            JSON.stringify({
                msg: 'get_state',
                data: { audio_1: { status: 'playing', current_track: { title: 'Sunrise' } } },
            }),
        );

        const query = sent().find((frame) => frame.includes('get_cover_url'));
        expect(query).toBeDefined();
        const msgId = String(JSON.parse(query as string).msg_id);

        FakeWebSocket.last.fireMessage(
            JSON.stringify({ msg: 'audio', msg_id: msgId, data: { cover: 'http://lms/17.jpg' } }),
        );
        expect(useAudioStore().coverUrlFor('audio_1')).toBe('http://lms/17.jpg');
    });

    // A reconnect replays get_home, and the audio detail has to be replayed
    // with it — the player may have changed song while the socket was down.
    it('re-reads the players after a reconnect, from a clean slate', () => {
        startAndOpen();
        signInAndLoadAudio();
        FakeWebSocket.last.fireMessage(
            JSON.stringify({ msg: 'get_state', data: { audio_1: { status: 'playing' } } }),
        );
        expect(useAudioStore().stateFor('audio_1').status).toBe('playing');

        FakeWebSocket.last.fireClose();
        vi.advanceTimersByTime(1000);
        FakeWebSocket.last.fireOpen();
        FakeWebSocket.last.fireMessage(LOGIN_OK);
        FakeWebSocket.last.fireMessage(HOME_WITH_AUDIO);

        // Stale detail is dropped, not carried across the gap.
        expect(useAudioStore().stateFor('audio_1').known).toBe(false);
        expect(sent()).toContain('{"msg":"get_state","data":{"items":["audio_1","audio_2"]}}');
    });
});

describe('audio events reach the audio store', () => {
    function fireEvent(typeStr: string, data: Record<string, string>): void {
        FakeWebSocket.last.fireMessage(
            JSON.stringify({ msg: 'event', data: { type_str: typeStr, data } }),
        );
    }

    it('routes a status event through the home store dispatch table', () => {
        startAndOpen();
        signInAndLoadAudio();

        fireEvent('audio_status_changed', { player_id: 'audio_1', state: 'play' });
        expect(useAudioStore().stateFor('audio_1').status).toBe('playing');
    });

    it('routes a volume event', () => {
        startAndOpen();
        signInAndLoadAudio();

        fireEvent('audio_volume_changed', { player_id: 'audio_2', volume: '70' });
        expect(useAudioStore().stateFor('audio_2').volume).toBe(70);
    });

    // A player's own io_changed frames — the raw command echo and the
    // on<state> mirrors — must be tolerated, not applied twice.
    it.each([['volume set 55'], ['onplay'], ['onsongchange']])(
        'tolerates a player io_changed carrying state %o',
        (state) => {
            startAndOpen();
            signInAndLoadAudio();

            expect(() => fireEvent('io_changed', { id: 'audio_1', state })).not.toThrow();
            // Not applied by the audio store: the typed audio_* event is the
            // one source of that change.
            expect(useAudioStore().stateFor('audio_1').known).toBe(false);
            expect(useAudioStore().stateFor('audio_1').volume).toBe(0);
        },
    );
});
