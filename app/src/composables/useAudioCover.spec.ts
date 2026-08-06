import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { useAudioCover } from './useAudioCover';
import * as coverService from '../services/audio-cover';
import type { AudioCover } from './useAudioCover';
import type { EffectScope } from 'vue';

const SESSION = { user: 'demo', pass: 'demo' };
const URL_A = 'http://lms.local:9000/music/17/cover.jpg';
const DATA_URL = 'data:image/jpeg;base64,QUJD';

let scope: EffectScope;
let fetchCover: ReturnType<typeof vi.spyOn>;

/** Reactive inputs, so a spec can change the track under a running chain. */
const playerId = ref('audio_1');
const coverUrl = ref('');
const resolved = ref(false);

/** Runs the composable inside a scope, so onScopeDispose has one to hook. */
function cover(width?: number): AudioCover {
    return scope.run(() =>
        useAudioCover(
            () => playerId.value,
            () => coverUrl.value,
            () => SESSION,
            () => resolved.value,
            { width },
        ),
    ) as AudioCover;
}

beforeEach(() => {
    scope = effectScope();
    playerId.value = 'audio_1';
    coverUrl.value = '';
    resolved.value = false;
    fetchCover = vi.spyOn(coverService, 'fetchCoverDataUrl').mockResolvedValue(DATA_URL);
});

afterEach(() => {
    scope.stop();
    vi.restoreAllMocks();
});

describe('stage 1 — the URL from get_cover_url', () => {
    it('shows nothing while the store is still waiting for an answer', () => {
        const art = cover();
        expect(art.src.value).toBe('');
        expect(art.stage.value).toBe('idle');
        // Not "missing": nobody has said there is no artwork yet.
        expect(art.missing.value).toBe(false);
        expect(fetchCover).not.toHaveBeenCalled();
    });

    it('binds the media server URL as soon as one arrives', async () => {
        const art = cover();
        coverUrl.value = URL_A;
        resolved.value = true;
        await nextTick();

        expect(art.src.value).toBe(URL_A);
        expect(art.stage.value).toBe('url');
        // The cheap path first: the server is not asked to re-encode anything
        // until the browser has proved it cannot reach the media host.
        expect(fetchCover).not.toHaveBeenCalled();
    });
});

describe('stage 2 — the base64 fallback', () => {
    // This is the whole reason the chain exists: the URL points at an LMS or
    // Roon host that may be on a network the browser cannot reach, which the
    // browser only reports as an `error` on the <img>.
    it('asks calaos_server for the bytes when the media URL will not load', async () => {
        const art = cover();
        coverUrl.value = URL_A;
        resolved.value = true;
        await nextTick();

        art.onError();
        await vi.waitFor(() => expect(art.stage.value).toBe('base64'));
        expect(art.src.value).toBe(DATA_URL);
        expect(fetchCover).toHaveBeenCalledWith('audio_1', SESSION, { width: undefined });
    });

    // An empty cover is an ANSWER, not a wait: the server said it has no URL,
    // and the base64 path resolves artwork differently server-side.
    it('tries the base64 path directly when the answer was an empty URL', async () => {
        const art = cover();
        resolved.value = true;
        await nextTick();

        await vi.waitFor(() => expect(art.stage.value).toBe('base64'));
        expect(art.src.value).toBe(DATA_URL);
    });

    it('asks for a thumbnail at the size the caller will actually render', async () => {
        const art = cover(160);
        resolved.value = true;
        await nextTick();

        await vi.waitFor(() => expect(art.stage.value).toBe('base64'));
        expect(fetchCover).toHaveBeenCalledWith('audio_1', SESSION, { width: 160 });
    });
});

describe('stage 3 — the placeholder', () => {
    it('gives up when the server has no cover either', async () => {
        fetchCover.mockResolvedValue('');
        const art = cover();
        resolved.value = true;
        await nextTick();

        await vi.waitFor(() => expect(art.missing.value).toBe(true));
        expect(art.src.value).toBe('');
        expect(art.stage.value).toBe('none');
    });

    it('gives up rather than retrying a base64 payload that will not decode', async () => {
        const art = cover();
        resolved.value = true;
        await nextTick();
        await vi.waitFor(() => expect(art.stage.value).toBe('base64'));

        art.onError();
        expect(art.stage.value).toBe('none');
        expect(art.missing.value).toBe(true);
        // One attempt, not two: bytes that failed to decode will fail again.
        expect(fetchCover).toHaveBeenCalledTimes(1);
    });

    it('gives up immediately when there is no player to ask about', async () => {
        playerId.value = '';
        const art = cover();
        resolved.value = true;
        await nextTick();

        await vi.waitFor(() => expect(art.missing.value).toBe(true));
        expect(fetchCover).not.toHaveBeenCalled();
    });
});

describe('restarts', () => {
    it('starts over when the track changes the URL under it', async () => {
        const art = cover();
        coverUrl.value = URL_A;
        resolved.value = true;
        await nextTick();
        art.onError();
        await vi.waitFor(() => expect(art.stage.value).toBe('base64'));

        coverUrl.value = 'http://lms.local:9000/music/18/cover.jpg';
        await nextTick();

        // Back to the cheap path for the new artwork, and no longer 'missing'.
        expect(art.src.value).toBe('http://lms.local:9000/music/18/cover.jpg');
        expect(art.stage.value).toBe('url');
        expect(art.missing.value).toBe(false);
    });

    it('follows the player when the view is reused for another one', async () => {
        const art = cover();
        resolved.value = true;
        await nextTick();
        await vi.waitFor(() => expect(art.stage.value).toBe('base64'));

        playerId.value = 'audio_2';
        await nextTick();
        await vi.waitFor(() => expect(fetchCover).toHaveBeenCalledTimes(2));
        expect(fetchCover).toHaveBeenLastCalledWith('audio_2', SESSION, { width: undefined });
    });

    // A slow answer for the previous song must not paint over the current one.
    it('drops a base64 answer that arrives after the track already moved on', async () => {
        let release: (value: string) => void = () => {};
        fetchCover.mockImplementation(
            () =>
                new Promise<string>((resolve) => {
                    release = resolve;
                }),
        );

        const art = cover();
        resolved.value = true;
        await nextTick();

        coverUrl.value = URL_A;
        await nextTick();
        release('data:image/jpeg;base64,T0xE');
        await nextTick();

        expect(art.src.value).toBe(URL_A);
        expect(art.stage.value).toBe('url');
    });

    it('drops an answer that arrives after the scope is gone', async () => {
        let release: (value: string) => void = () => {};
        fetchCover.mockImplementation(
            () =>
                new Promise<string>((resolve) => {
                    release = resolve;
                }),
        );

        const art = cover();
        resolved.value = true;
        await nextTick();
        scope.stop();

        release(DATA_URL);
        await nextTick();
        expect(art.src.value).toBe('');
    });
});
