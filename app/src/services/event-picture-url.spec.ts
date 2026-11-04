import { describe, expect, it } from 'vitest';
import { eventPictureUrl } from './event-picture-url';

describe('eventPictureUrl', () => {
    it('carries the credentials, as the server checks them before any action', () => {
        expect(eventPictureUrl('pic1', { user: 'demo', pass: 'demo' })).toBe(
            '/api?cn_user=demo&cn_pass=demo&action=event_picture&pic_uid=pic1',
        );
    });

    it('percent-encodes every part', () => {
        expect(eventPictureUrl('a&b=1', { user: 'a b', pass: 'x#' })).toBe(
            '/api?cn_user=a%20b&cn_pass=x%23&action=event_picture&pic_uid=a%26b%3D1',
        );
    });
});
