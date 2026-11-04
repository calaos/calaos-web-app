// The snapshot URL of one camera.
//
// Camera snapshots are the only part of the calaos protocol that is not
// WebSocket: the server answers
// `GET /api?action=camera&type=get_picture&camera_token=..&id=..` with a still
// frame. An `<img>` can only carry GET parameters, so the URL carries a
// short-lived capture token handed out by the live session
// (stores/cameraToken.ts) — never the household password. The server still
// accepts `cn_user`/`cn_pass` there for older clients; this app no longer
// sends them (calaos_base docs/08_http_api.md, "jeton de capture").
//
// The URL is relative: `/api?...` is correct behind calaos_server, behind the
// Vite dev proxy, and behind `vite preview` in the E2E rig. The old app built
// an absolute origin by hand and produced `https://calaos.local:/api` on the
// default port (see protocol/server-url.ts).

/**
 * The snapshot URL for one camera — a single still, not a stream — or '' when
 * there is no token: no request may go out without one.
 *
 * `id` comes last on purpose: callers append their own cache-buster
 * (`&t=<now>`, see composables/useCameraPoll.ts), which is only safe if this
 * function always produces at least one parameter.
 */
export function cameraSnapshotUrl(cameraId: string, token: string): string {
    if (token === '') return '';
    const tok = encodeURIComponent(token);
    const id = encodeURIComponent(cameraId);

    return `/api?action=camera&type=get_picture&camera_token=${tok}&id=${id}`;
}
