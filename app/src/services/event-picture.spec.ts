import { describe, expect, it, vi } from 'vitest';
import { EventPictureHolder, fetchEventPicture } from './event-picture';

const SESSION = { user: 'demo', pass: 'sécret&#' };

function blobFetch(ok = true) {
    return vi.fn(async () => ({ ok, blob: async () => new Blob(['x']) }) as unknown as Response);
}

function seams(fetchImpl: typeof fetch) {
    let n = 0;
    return {
        fetchImpl,
        createObjectUrl: vi.fn(() => `blob:${++n}`),
        revokeObjectUrl: vi.fn(),
    };
}

describe('fetchEventPicture', () => {
    it('posts the credentials in the JSON body, never in the URL', async () => {
        const fetchImpl = blobFetch();
        const url = await fetchEventPicture('pic1', SESSION, seams(fetchImpl as unknown as typeof fetch));
        expect(url).toBe('blob:1');
        const [target, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(target).toBe('/api');
        expect(init.method).toBe('POST');
        expect(init.cache).toBe('no-store');
        expect(JSON.parse(String(init.body))).toEqual({
            cn_user: 'demo',
            cn_pass: 'sécret&#',
            action: 'event_picture',
            pic_uid: 'pic1',
        });
    });

    it('answers an empty string on 404 or a network error, without throwing', async () => {
        expect(await fetchEventPicture('p', SESSION, seams(blobFetch(false) as unknown as typeof fetch))).toBe('');
        const boom = vi.fn(async () => {
            throw new Error('offline');
        });
        expect(await fetchEventPicture('p', SESSION, seams(boom as unknown as typeof fetch))).toBe('');
    });
});

describe('EventPictureHolder', () => {
    it('revokes the previous URL when another picture loads, and on clear', async () => {
        const s = seams(blobFetch() as unknown as typeof fetch);
        const holder = new EventPictureHolder(s);
        await holder.load('a', SESSION);
        expect(holder.url).toBe('blob:1');
        await holder.load('b', SESSION);
        expect(s.revokeObjectUrl).toHaveBeenCalledWith('blob:1');
        expect(holder.url).toBe('blob:2');
        holder.clear();
        expect(s.revokeObjectUrl).toHaveBeenCalledWith('blob:2');
        expect(holder.url).toBe('');
    });

    it('revokes a picture that arrives after clear() or a newer load', async () => {
        const s = seams(blobFetch() as unknown as typeof fetch);
        const holder = new EventPictureHolder(s);
        const late = holder.load('a', SESSION);
        holder.clear();
        await late;
        expect(s.revokeObjectUrl).toHaveBeenCalledWith('blob:1');
        expect(holder.url).toBe('');
    });
});
