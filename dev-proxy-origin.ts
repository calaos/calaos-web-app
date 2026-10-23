import type { ClientRequest, IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

/**
 * True when `origin` is the page served by this Vite dev/preview server.
 *
 * Rebinding names are not trusted: the proxied WS upgrade bypasses Vite's
 * `allowedHosts` check, so only loopback names and IP literals qualify.
 */
export function isDevServerOrigin(origin: string | undefined, host: string | undefined): boolean {
    if (!origin || !host) return false;
    let url: URL;
    let hostUrl: URL;
    try {
        url = new URL(origin);
        hostUrl = new URL(`${url.protocol}//${host}`);
    } catch {
        return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    // Browsers send the serialized form; anything else did not come from one.
    if (url.origin !== origin) return false;
    if (url.host !== hostUrl.host) return false;

    const name = url.hostname.replace(/^\[(.*)\]$/, '$1');
    return name === 'localhost' || name.endsWith('.localhost') || isIP(name) !== 0;
}

/**
 * calaos_server refuses an Origin outside its allow-list once an admin is set,
 * and `http://localhost:5173` is never on it; an absent Origin is accepted.
 * Foreign Origins are forwarded untouched so the server still refuses them.
 */
export function stripDevServerOrigin(proxyReq: ClientRequest, req: IncomingMessage): void {
    if (isDevServerOrigin(req.headers.origin, req.headers.host)) proxyReq.removeHeader('origin');
}
