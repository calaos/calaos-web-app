import { describe, expect, it, vi } from 'vitest';
import { fetchCoverDataUrl } from './audio-cover';

const SESSION = { user: 'demo', pass: 'sécret' };

/** A fetch that answers one JSON payload and records what it was asked. */
function jsonFetch(payload: unknown, ok = true) {
    const impl = vi.fn(async () => ({ ok, json: async () => payload }) as unknown as Response);
    return impl as unknown as typeof fetch & { mock: { calls: unknown[][] } };
}

function bodyOf(impl: unknown): Record<string, unknown> {
    const [, init] = (impl as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    return JSON.parse(String(init.body));
}

const SUCCESS = {
    success: 'true',
    contenttype: 'image/jpeg',
    encoding: 'base64',
    data: 'QUJD',
};

describe('fetchCoverDataUrl', () => {
    it('posts the credentials and the player id in the JSON body', async () => {
        const fetchImpl = jsonFetch(SUCCESS);
        await fetchCoverDataUrl('audio_1', SESSION, { fetchImpl });

        const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } })
            .mock.calls[0];
        // Relative, like every other request the app makes: same-origin behind
        // calaos_server, behind the Vite proxy, and behind `vite preview`.
        expect(url).toBe('/api');
        expect(init.method).toBe('POST');
        expect(bodyOf(fetchImpl)).toEqual({
            cn_user: 'demo',
            cn_pass: 'sécret',
            action: 'get_cover',
            id: 'audio_1',
        });
    });

    it('sends the thumbnail width as a string, like every value on this protocol', async () => {
        const fetchImpl = jsonFetch(SUCCESS);
        await fetchCoverDataUrl('audio_1', SESSION, { fetchImpl, width: 160 });
        expect(bodyOf(fetchImpl).width).toBe('160');
    });

    it('omits width entirely when none was asked for', async () => {
        const fetchImpl = jsonFetch(SUCCESS);
        await fetchCoverDataUrl('audio_1', SESSION, { fetchImpl });
        expect(bodyOf(fetchImpl)).not.toHaveProperty('width');
    });

    it('turns a success envelope into a data URL the browser can render', async () => {
        const src = await fetchCoverDataUrl('audio_1', SESSION, { fetchImpl: jsonFetch(SUCCESS) });
        expect(src).toBe('data:image/jpeg;base64,QUJD');
    });

    it('falls back to image/jpeg when the server named no content type', async () => {
        const src = await fetchCoverDataUrl('audio_1', SESSION, {
            fetchImpl: jsonFetch({ success: 'true', encoding: 'base64', data: 'QUJD' }),
        });
        expect(src).toBe('data:image/jpeg;base64,QUJD');
    });

    // Every failure folds into the same '' — the view's answer to all of them
    // is the same placeholder, so distinguishing them would buy nothing.
    it.each([
        ['id not set', { success: 'false', error_str: 'id not set' }],
        ['unable get url', { success: 'false', error_str: 'unable get url' }],
        ['a boolean success (only the STRING true counts)', { success: true, data: 'QUJD' }],
        ['an empty payload', { success: 'true', data: '' }],
        ['an encoding the browser cannot decode', { success: 'true', encoding: 'hex', data: 'ab' }],
        ['a non-object answer', 'not json at all'],
        ['null', null],
    ])('answers "" for %s', async (_label, payload) => {
        expect(await fetchCoverDataUrl('audio_1', SESSION, { fetchImpl: jsonFetch(payload) })).toBe(
            '',
        );
    });

    // Bad credentials get an HTML error page from calaos_server, not JSON.
    it('answers "" for the HTTP 400 bad credentials get', async () => {
        const fetchImpl = jsonFetch({ success: 'true', data: 'QUJD' }, false);
        expect(await fetchCoverDataUrl('audio_1', SESSION, { fetchImpl })).toBe('');
    });

    it('never rejects when the network does', async () => {
        const fetchImpl = vi.fn(async () => {
            throw new Error('offline');
        }) as unknown as typeof fetch;
        await expect(fetchCoverDataUrl('audio_1', SESSION, { fetchImpl })).resolves.toBe('');
    });

    it('never rejects when the answer is not parseable JSON', async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            json: async () => {
                throw new SyntaxError('unexpected token');
            },
        })) as unknown as typeof fetch;
        await expect(fetchCoverDataUrl('audio_1', SESSION, { fetchImpl })).resolves.toBe('');
    });
});
