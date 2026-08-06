// The second of the two cover-art paths (docs/audio-protocol.md "Cover art"),
// and the only other place in the app that speaks HTTP rather than WebSocket.
//
// Path one is the WS query `get_cover_url`, which answers a URL on the MEDIA
// server — an LMS or Roon host that may sit on a different network from the
// browser. Path two is this one: calaos_server fetches the artwork itself and
// hands back base64, so it always resolves from wherever the app is served.
//
// It is the fallback rather than the default because it costs the server a
// download and a re-encode per request, where the URL costs it nothing.
//
// Credentials ride in the JSON body, not the query string (that is what the
// endpoint takes; camera snapshots differ — see services/camera-url.ts). They
// are an argument, never an import, so this module holds no state and
// `cn_user`/`cn_pass` stay confined to the two files that must know them.

/** Plain credentials; the auth store's `user`/`pass`, passed by the caller. */
export interface CoverCredentials {
    user: string;
    pass: string;
}

export interface CoverRequestOptions {
    /** Server-side thumbnail width in pixels. Omitted → the original size. */
    width?: number;
    /** Injectable for tests; defaults to the global fetch. */
    fetchImpl?: typeof fetch;
}

/**
 * Fetches one player's cover as a `data:` URL, or '' when there is none.
 *
 * NEVER throws and NEVER rejects: a missing cover is an ordinary outcome
 * (a radio stream, a track the server could not resolve, a dropped network),
 * and the only sensible answer to all of them is the same placeholder. The
 * failure modes it folds into '' are the upstream ones — `{success:'false',
 * error_str:'id not set'|'unable get url'}` — plus the HTTP 400 page bad
 * credentials get, and anything the network does.
 */
export async function fetchCoverDataUrl(
    playerId: string,
    credentials: CoverCredentials,
    options: CoverRequestOptions = {},
): Promise<string> {
    const { width, fetchImpl = fetch } = options;

    const body: Record<string, string> = {
        cn_user: credentials.user,
        cn_pass: credentials.pass,
        action: 'get_cover',
        id: playerId,
    };
    // Every value on the calaos wire is a string, this endpoint included.
    if (width !== undefined) body.width = String(width);

    try {
        const response = await fetchImpl('/api', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
        // Bad credentials answer an HTML error page, not JSON.
        if (!response.ok) return '';

        const payload: unknown = await response.json();
        if (typeof payload !== 'object' || payload === null) return '';

        const { success, data, contenttype, encoding } = payload as Record<string, unknown>;
        // The string 'true', like every boolean on this protocol.
        if (success !== 'true' || typeof data !== 'string' || data === '') return '';
        // The endpoint only ever answers base64 today; refusing anything else
        // is cheaper than building a data: URL the browser cannot decode.
        if (encoding !== undefined && encoding !== 'base64') return '';

        const mime = typeof contenttype === 'string' && contenttype !== '' ? contenttype : 'image/jpeg';
        return `data:${mime};base64,${data}`;
    } catch {
        return '';
    }
}
