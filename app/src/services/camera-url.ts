// The ONE module in the app that ever writes credentials into a URL.
//
// Camera snapshots are the only part of the calaos protocol that is not
// WebSocket: the server answers
// `GET /api?cn_user=..&cn_pass=..&action=camera&type=get_picture&id=..` with a
// still frame. There is no cookie, no token and no header auth on that
// endpoint, so the credentials travel in the query string. That is a SERVER
// constraint, transcribed verbatim from the old app
// (src/scripts/services.js:143-167) — parameter names and order included.
//
// What DID change:
//
//  - The URL is relative. The old app assembled an absolute origin by hand
//    (`location.protocol + '//' + location.hostname + ':' + location.port`),
//    which carries the same dangling-colon bug as the old WebSocket URL
//    (`https://calaos.local:/api` whenever the page is served on the default
//    port — see protocol/server-url.ts), and it read an alternative host out
//    of a `calaosDevConfig` global that only existed in development. A
//    relative `/api?...` is correct in all three environments the app runs
//    in: same-origin behind calaos_server, behind the Vite dev proxy, and
//    behind `vite preview` in the E2E rig.
//
//  - Credentials are an argument, never an import. This module holds no state
//    and reads no store, so it stays trivially testable and — the point of the
//    exercise (docs/tasks/T15) — `cn_user`/`cn_pass` appear in exactly one
//    place in `app/src`. Everything upstream speaks of `user`/`pass`.

/** Plain credentials; the auth store's `user`/`pass`, passed by the caller. */
export interface CameraCredentials {
    user: string;
    pass: string;
}

/**
 * The snapshot URL for one camera — a single still, not a stream.
 *
 * `id` comes last on purpose: callers append their own cache-buster
 * (`&t=<now>`, see composables/useCameraPoll.ts) and appending to a query
 * string that already has parameters is only safe if this function always
 * produces at least one.
 *
 * Percent-encoding rather than `URLSearchParams`: the latter encodes a space
 * as `+`, which only decodes back to a space in a parser that treats the query
 * as `application/x-www-form-urlencoded`. `encodeURIComponent` is what the old
 * app sent and what every parser reads the same way — a password containing a
 * space must not become a different password on the wire.
 */
export function cameraSnapshotUrl(cameraId: string, credentials: CameraCredentials): string {
    const user = encodeURIComponent(credentials.user);
    const pass = encodeURIComponent(credentials.pass);
    const id = encodeURIComponent(cameraId);

    return `/api?cn_user=${user}&cn_pass=${pass}&action=camera&type=get_picture&id=${id}`;
}
