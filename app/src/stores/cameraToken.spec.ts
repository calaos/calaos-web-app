import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAuthStore } from './auth';
import {
    MAX_LIFETIME_S,
    MIN_LIFETIME_S,
    RENEW_MARGIN_S,
    REPLY_TIMEOUT_MS,
    RETRY_MAX_MS,
    RETRY_MIN_MS,
    useCameraTokenStore,
} from './cameraToken';
import type { CameraTokenMessage } from '../protocol/types';

const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);

let sent: { msg: string; msg_id: string }[];
let transportUp: boolean;

function store() {
    return useCameraTokenStore();
}

function lastId(): string {
    const frame = sent[sent.length - 1];
    if (frame === undefined) throw new Error('nothing was sent');
    return frame.msg_id;
}

function reply(fields: Partial<CameraTokenMessage> = {}): void {
    store().handleReply({
        kind: 'camera_token',
        msgId: lastId(),
        token: TOKEN_A,
        expiresIn: 120,
        error: '',
        ...fields,
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    sent = [];
    transportUp = true;
    const auth = useAuthStore();
    auth.attachTransport(() => true);
    auth.user = 'demo';
    auth.pass = 'demo';
    auth.state = 'authed';
    store().attachTransport((frame) => {
        if (!transportUp) return false;
        sent.push(JSON.parse(frame) as { msg: string; msg_id: string });
        return true;
    });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('cameraToken — asking', () => {
    it('asks once a camera is on screen, and exposes the answer', () => {
        expect(sent).toHaveLength(0);

        store().acquire();
        expect(sent).toEqual([{ msg: 'camera_token', msg_id: lastId() }]);
        expect(store().token).toBe('');

        reply();
        expect(store().token).toBe(TOKEN_A);
    });

    it('asks nothing while no camera is on screen', () => {
        store().handleLoggedIn();
        vi.advanceTimersByTime(600_000);

        expect(sent).toHaveLength(0);
    });

    it('asks nothing for a session that is not logged in', () => {
        useAuthStore().state = 'pending';

        store().acquire();
        vi.advanceTimersByTime(600_000);

        expect(sent).toHaveLength(0);
    });

    it('shares one request between every camera on screen', () => {
        store().acquire();
        store().acquire();
        store().acquire();

        expect(sent).toHaveLength(1);
    });

    it('ignores an answer it did not ask for', () => {
        store().acquire();
        const asked = lastId();

        store().handleReply({ kind: 'camera_token', msgId: 'camera_token:999', token: TOKEN_B, expiresIn: 120, error: '' });
        expect(store().token).toBe('');

        store().handleReply({ kind: 'camera_token', msgId: asked, token: TOKEN_A, expiresIn: 120, error: '' });
        expect(store().token).toBe(TOKEN_A);
        // Answered once: a replay of the same reply changes nothing.
        store().handleReply({ kind: 'camera_token', msgId: asked, token: TOKEN_B, expiresIn: 120, error: '' });
        expect(store().token).toBe(TOKEN_A);
    });
});

describe('cameraToken — renewal', () => {
    it('renews before expiry, and the old token stays usable meanwhile', () => {
        store().acquire();
        reply();

        vi.advanceTimersByTime((120 - RENEW_MARGIN_S) * 1000 - 1);
        expect(sent).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(sent).toHaveLength(2);
        expect(store().token).toBe(TOKEN_A);

        reply({ token: TOKEN_B });
        expect(store().token).toBe(TOKEN_B);
    });

    it('renews a short-lived token halfway rather than on top of its expiry', () => {
        store().acquire();
        reply({ expiresIn: 40 });

        vi.advanceTimersByTime(20_000 - 1);
        expect(sent).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(sent).toHaveLength(2);
    });

    it('raises an absurdly short lifetime to the minimum', () => {
        store().acquire();
        reply({ expiresIn: 0.001 });

        vi.advanceTimersByTime((MIN_LIFETIME_S * 1000) / 2 - 1);
        expect(sent).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(sent).toHaveLength(2);
    });

    it('caps an absurdly long lifetime instead of overflowing setTimeout', () => {
        store().acquire();
        reply({ expiresIn: 1e12 });

        vi.advanceTimersByTime(MAX_LIFETIME_S * 1000 - RENEW_MARGIN_S * 1000 - 1);
        expect(sent).toHaveLength(1);
        expect(store().token).toBe(TOKEN_A);
        vi.advanceTimersByTime(1);
        expect(sent).toHaveLength(2);
    });

    it('takes a reply without a lifetime for a refusal', () => {
        store().acquire();
        reply({ expiresIn: null });

        expect(store().token).toBe('');
    });

    it('drops the token at expiry if no renewal made it', () => {
        store().acquire();
        reply();
        // The renewal goes out, and is never answered in time to matter.
        vi.advanceTimersByTime(120_000);

        expect(store().token).toBe('');
    });

    it('stops renewing once no camera is on screen, but keeps the token until expiry', () => {
        store().acquire();
        reply();
        store().release();

        vi.advanceTimersByTime(119_000);
        expect(sent).toHaveLength(1);
        expect(store().token).toBe(TOKEN_A);

        vi.advanceTimersByTime(1000);
        expect(store().token).toBe('');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('reuses a token still valid when a camera comes back, renewing it on time', () => {
        store().acquire();
        reply();
        store().release();
        vi.advanceTimersByTime(60_000);

        store().acquire();
        expect(sent).toHaveLength(1);
        expect(store().token).toBe(TOKEN_A);

        vi.advanceTimersByTime((120 - RENEW_MARGIN_S) * 1000 - 60_000);
        expect(sent).toHaveLength(2);
    });
});

describe('cameraToken — failures', () => {
    it('retries a refused request with a growing delay', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        store().acquire();
        reply({ token: '', expiresIn: null, error: 'camera token unavailable' });

        vi.advanceTimersByTime(RETRY_MIN_MS);
        expect(sent).toHaveLength(2);
        reply({ token: '', expiresIn: null, error: 'camera token unavailable' });

        vi.advanceTimersByTime(RETRY_MIN_MS);
        expect(sent).toHaveLength(2);
        vi.advanceTimersByTime(RETRY_MIN_MS);
        expect(sent).toHaveLength(3);
    });

    it('caps the retry delay', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        store().acquire();
        for (let attempt = 0; attempt < 10; attempt += 1) {
            reply({ token: '', expiresIn: null, error: 'camera token unavailable' });
            vi.advanceTimersToNextTimer();
        }
        const before = sent.length;
        reply({ token: '', expiresIn: null, error: 'camera token unavailable' });

        vi.advanceTimersByTime(RETRY_MAX_MS - 1);
        expect(sent).toHaveLength(before);
        vi.advanceTimersByTime(1);
        expect(sent).toHaveLength(before + 1);
    });

    it('gives up on an unanswered request and asks again', () => {
        store().acquire();
        const first = lastId();

        vi.advanceTimersByTime(REPLY_TIMEOUT_MS + RETRY_MIN_MS);

        expect(sent).toHaveLength(2);
        expect(lastId()).not.toBe(first);
        // The late answer to the abandoned request is not taken.
        store().handleReply({ kind: 'camera_token', msgId: first, token: TOKEN_B, expiresIn: 120, error: '' });
        expect(store().token).toBe('');
    });

    it('retries when the socket could not take the frame', () => {
        transportUp = false;
        store().acquire();
        transportUp = true;

        vi.advanceTimersByTime(RETRY_MIN_MS);

        expect(sent).toHaveLength(1);
    });
});

describe('cameraToken — end of the session', () => {
    it('exposes nothing the moment the login is refused', () => {
        store().acquire();
        reply();
        const auth = useAuthStore();

        auth.rotateCredentials('demo', 'wrong');
        auth.handleLoginResult(false);

        expect(store().token).toBe('');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('exposes nothing after sign-out', () => {
        store().acquire();
        reply();

        useAuthStore().signOut();

        expect(store().token).toBe('');
        vi.advanceTimersByTime(600_000);
        expect(sent).toHaveLength(1);
    });

    it('drops everything on invalidate, including a request in flight', () => {
        store().acquire();
        reply();
        vi.advanceTimersByTime((120 - RENEW_MARGIN_S) * 1000);
        const renewal = lastId();

        store().invalidate();

        expect(store().token).toBe('');
        expect(vi.getTimerCount()).toBe(0);
        store().handleReply({ kind: 'camera_token', msgId: renewal, token: TOKEN_B, expiresIn: 120, error: '' });
        expect(store().token).toBe('');
    });

    it('asks for a fresh token on every login, even with one in hand', () => {
        store().acquire();
        reply();

        store().handleLoggedIn();

        expect(store().token).toBe('');
        expect(sent).toHaveLength(2);
        reply({ token: TOKEN_B });
        expect(store().token).toBe(TOKEN_B);
    });
});
