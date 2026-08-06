// WebSocket URL derivation. NO Vue imports in this directory.
//
// Production is same-origin: calaos_server serves the static app and the
// websocket endpoint on the same host/port, so the URL is derived from
// `location` alone (see docs/ARCHITECTURE.md "Deployment invariants"). In dev
// the Vite proxy forwards /api, so this holds there too — there is no
// VITE_ override in the bundle.

// Structural subset of `Location` — lets tests pass a plain object and keeps
// this module DOM-free apart from the default argument.
export interface UrlLocation {
    protocol: string;
    host: string;
}

// `${'wss://'|'ws://'}${host}/api`.
//
// Deliberate fix: the old app built `hostname + ':' + port` (services.js
// getHost), which produced `ws://calaos.local:/api` — a dangling colon —
// whenever the page was served on the default port, because `location.port`
// is '' there. `location.host` already carries the port only when there is
// one, so it handles both cases.
//
// Only `https:` upgrades to `wss:`; anything else (http:, file:, ...) uses
// the plain `ws:` scheme, exactly like the old code's `=== 'http:'` test
// inverted.
export function wsUrl(loc: UrlLocation = location): string {
    const scheme = loc.protocol === 'https:' ? 'wss://' : 'ws://';
    return `${scheme}${loc.host}/api`;
}
