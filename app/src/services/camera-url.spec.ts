import { describe, expect, it } from 'vitest';
import { cameraSnapshotUrl } from './camera-url';

const TOKEN = 'a'.repeat(64);

describe('cameraSnapshotUrl', () => {
    it('builds the query the server expects', () => {
        // The shape is a server constraint (docs/ARCHITECTURE.md "Camera
        // polling"), so this assertion is deliberately literal: if it has to
        // change, calaos_server changed.
        expect(cameraSnapshotUrl('camera_1', TOKEN)).toBe(
            `/api?action=camera&type=get_picture&camera_token=${TOKEN}&id=camera_1`,
        );
    });

    it('never carries the household credentials', () => {
        const url = cameraSnapshotUrl('camera_1', TOKEN);

        expect(url).not.toContain('cn_user');
        expect(url).not.toContain('cn_pass');
    });

    it('is empty without a token, so no request can go out', () => {
        // An empty `camera_token=` would still be a request, refused by the
        // server with a 400: the caller must not send anything at all.
        expect(cameraSnapshotUrl('camera_1', '')).toBe('');
    });

    it('stays relative, so the same URL works in dev, preview and production', () => {
        const url = cameraSnapshotUrl('camera_1', TOKEN);

        expect(url.startsWith('/api?')).toBe(true);
        // The old app built an absolute origin by hand and produced
        // `http://calaos.local:/api` on the default port.
        expect(url).not.toContain('//');
    });

    it('escapes characters that would otherwise end the parameter', () => {
        expect(cameraSnapshotUrl('cam&id=2', 'x=y&z#1')).toBe(
            '/api?action=camera&type=get_picture&camera_token=x%3Dy%26z%231&id=cam%26id%3D2',
        );
    });

    it('ends with the camera id, so a cache-buster can be appended', () => {
        // useCameraPoll appends `&t=<now>`; that only composes because the URL
        // already carries a query string and nothing follows the id.
        const url = `${cameraSnapshotUrl('camera_2', TOKEN)}&t=1700000000000`;
        const query = new URLSearchParams(url.slice(url.indexOf('?') + 1));

        expect(query.get('id')).toBe('camera_2');
        expect(query.get('camera_token')).toBe(TOKEN);
        expect(url.endsWith('&t=1700000000000')).toBe(true);
    });
});
