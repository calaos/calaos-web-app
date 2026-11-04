// The JPEG attached to an event (`pic_uid` of a push-notification event).
//
// Credentials ride in a POST JSON body, as in audio-cover.ts: calaos_server
// reads cn_user/cn_pass from the body or the query alike, and an event picture
// is loaded once, so there is no reason to put the password in an URL (haproxy
// access log, HTTP cache, DOM `src`, "copy image address").

export interface EventPictureCredentials {
    user: string;
    pass: string;
}

export interface EventPictureOptions {
    /** Injectable for tests; default to the globals. */
    fetchImpl?: typeof fetch;
    createObjectUrl?: (blob: Blob) => string;
    revokeObjectUrl?: (url: string) => void;
}

/**
 * Fetches one picture as a `blob:` URL, or '' when there is none (404 for an
 * unknown pic_uid, bad credentials, network). Never throws. The caller owns
 * the URL and must revoke it; EventPictureHolder does.
 */
export async function fetchEventPicture(
    picUid: string,
    credentials: EventPictureCredentials,
    options: EventPictureOptions = {},
): Promise<string> {
    const { fetchImpl = fetch, createObjectUrl = (blob) => URL.createObjectURL(blob) } = options;
    try {
        const response = await fetchImpl('/api', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            cache: 'no-store',
            body: JSON.stringify({
                cn_user: credentials.user,
                cn_pass: credentials.pass,
                action: 'event_picture',
                pic_uid: picUid,
            }),
        });
        if (!response.ok) return '';
        return createObjectUrl(await response.blob());
    } catch {
        return '';
    }
}

/**
 * Owns the blob URL of the picture on screen: loading another one, clear() or a
 * superseded load revokes the previous URL, so none outlives its use.
 */
export class EventPictureHolder {
    url = '';
    private seq = 0;
    private readonly options: EventPictureOptions;

    constructor(options: EventPictureOptions = {}) {
        this.options = options;
    }

    async load(picUid: string, credentials: EventPictureCredentials): Promise<void> {
        const seq = ++this.seq;
        this.release();
        const url = await fetchEventPicture(picUid, credentials, this.options);
        if (seq !== this.seq) {
            this.revoke(url);
            return;
        }
        this.url = url;
    }

    clear(): void {
        this.seq += 1;
        this.release();
    }

    private release(): void {
        this.revoke(this.url);
        this.url = '';
    }

    private revoke(url: string): void {
        if (url === '') return;
        (this.options.revokeObjectUrl ?? ((u) => URL.revokeObjectURL(u)))(url);
    }
}
