import { describe, expect, it } from 'vitest';
import { cameraSnapshotUrl } from './camera-url';

const DEMO = { user: 'demo', pass: 'demo' };

describe('cameraSnapshotUrl', () => {
    it('builds the query the server expects, in the server’s order', () => {
        // The shape is a server constraint (docs/ARCHITECTURE.md "Camera
        // polling"), so this assertion is deliberately literal: if it has to
        // change, calaos_server changed.
        expect(cameraSnapshotUrl('camera_1', DEMO)).toBe(
            '/api?cn_user=demo&cn_pass=demo&action=camera&type=get_picture&id=camera_1',
        );
    });

    it('stays relative, so the same URL works in dev, preview and production', () => {
        const url = cameraSnapshotUrl('camera_1', DEMO);

        expect(url.startsWith('/api?')).toBe(true);
        // The old app built an absolute origin by hand and produced
        // `http://calaos.local:/api` on the default port.
        expect(url).not.toContain('//');
    });

    it('percent-encodes credentials instead of form-encoding them', () => {
        // `URLSearchParams` would send `p+ss`, which is a DIFFERENT password
        // to any parser that is not reading form data.
        const url = cameraSnapshotUrl('camera_1', { user: 'jean luc', pass: 'p ss' });

        expect(url).toContain('cn_user=jean%20luc');
        expect(url).toContain('cn_pass=p%20ss');
    });

    it('escapes characters that would otherwise end the parameter', () => {
        const url = cameraSnapshotUrl('cam&id=2', { user: 'a&b', pass: 'x=y&z#1' });

        expect(url).toBe(
            '/api?cn_user=a%26b&cn_pass=x%3Dy%26z%231&action=camera&type=get_picture&id=cam%26id%3D2',
        );
    });

    it('ends with the camera id, so a cache-buster can be appended', () => {
        // useCameraPoll appends `&t=<now>`; that only composes because the URL
        // already carries a query string and nothing follows the id.
        const url = `${cameraSnapshotUrl('camera_2', DEMO)}&t=1700000000000`;

        expect(new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('id')).toBe('camera_2');
        expect(url.endsWith('&t=1700000000000')).toBe(true);
    });

    it('still produces a well-formed URL for empty credentials', () => {
        // Reachable for a frame after sign-out: the store empties before the
        // navigation away completes. A malformed URL would be worse than a
        // request the server refuses with 403.
        expect(cameraSnapshotUrl('camera_1', { user: '', pass: '' })).toBe(
            '/api?cn_user=&cn_pass=&action=camera&type=get_picture&id=camera_1',
        );
    });
});
