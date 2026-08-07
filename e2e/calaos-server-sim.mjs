#!/usr/bin/env node
// calaos_server's HTTP router, reproduced — the production URL layout that
// `vite preview` does NOT have.
//
// Why this exists: in production the app is NOT served at the origin root.
// calaos_base's src/bin/calaos_server/HttpClient.cpp routes like this:
//
//   /  |  /app  |  /app/        → 301 Location: /app/index.html
//   /app/<path>                 → static file from the webapp directory
//   /api                        → the API (HTTP actions + WebSocket upgrade)
//   everything else             → 404, Content-Type: text/html
//
// Every other server in this repo (`vite dev`, `vite preview`, the mock)
// serves the app at `/`, so a bundle whose asset URLs are absolute passes the
// whole suite and then 404s on a real box — the browser asks for
// `/assets/index-*.js`, gets that text/html 404 page, and refuses to execute
// it ("MIME type of text/html is not a valid JavaScript MIME type"). That is
// exactly the bug e2e/app-prefix.spec.ts pins, and this server is the only
// place in the repo where it can reproduce.
//
// Static files come from ../dist, so this must start AFTER the build —
// playwright.config.ts orders it last in `webServer` for that reason.
// `/api` (both the HTTP actions and the WebSocket) is forwarded verbatim to
// the mock calaos_server, which is what makes a full sign-in possible through
// the prefix.

import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { createReadStream, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PORT = 4180;
const PORT = Number(process.env.PORT) || DEFAULT_PORT;

/** Where the API lives. Must match MOCK_PORT in playwright.config.ts. */
const API_HOST = process.env.API_HOST || '127.0.0.1';
const API_PORT = Number(process.env.API_PORT) || 5454;

/** The built bundle. `vite build` writes it (vite.config.ts `build.outDir`). */
const DIST = fileURLToPath(new URL('../dist', import.meta.url));

/** The prefix the whole app lives under, trailing slash included. */
const PREFIX = '/app/';
/** Where `/`, `/app` and `/app/` all land. */
const ENTRY = '/app/index.html';

/**
 * Content types for what a Vite bundle actually emits. `text/html` for
 * anything unknown is deliberate: that is what upstream answers with, and it
 * is the header that turns a missing script into a MIME error rather than a
 * silent 404.
 */
const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.map': 'application/json; charset=utf-8',
};

function contentTypeFor(path) {
    const dot = path.lastIndexOf('.');
    const ext = dot === -1 ? '' : path.slice(dot).toLowerCase();
    return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * Upstream's catch-all. The `text/html` is the whole point — see the header
 * comment — so it is spelled out here rather than left to a default.
 */
function notFound(res) {
    const body =
        '<html><head><title>404 Not Found</title></head>' +
        '<body><h1>Not Found</h1></body></html>';
    res.writeHead(404, {
        'content-type': 'text/html',
        'content-length': String(Buffer.byteLength(body)),
    });
    res.end(body);
}

function redirectToEntry(res) {
    res.writeHead(301, { location: ENTRY, 'content-length': '0' });
    res.end();
}

/**
 * Serves `/app/<rest>` out of dist/.
 *
 * `normalize` after decoding, then a prefix check against DIST: `%2e%2e%2f`
 * and friends must not walk out of the bundle.
 */
function serveStatic(pathname, res) {
    let rest;
    try {
        rest = decodeURIComponent(pathname.slice(PREFIX.length));
    } catch {
        notFound(res); // malformed percent-encoding
        return;
    }

    const target = normalize(join(DIST, rest));
    if (target !== DIST && !target.startsWith(DIST + sep)) {
        notFound(res);
        return;
    }

    let stats;
    try {
        stats = statSync(target);
    } catch {
        notFound(res);
        return;
    }
    // No directory listing and no index fallback: upstream serves files, and
    // `/app/` is already handled by the redirect above.
    if (!stats.isFile()) {
        notFound(res);
        return;
    }

    res.writeHead(200, {
        'content-type': contentTypeFor(target),
        'content-length': String(stats.size),
        'cache-control': 'no-store',
    });
    createReadStream(target)
        .on('error', () => res.destroy())
        .pipe(res);
}

/** `/api` over plain HTTP (camera snapshots, the get_cover POST). */
function proxyApi(req, res) {
    const upstream = httpRequest(
        {
            host: API_HOST,
            port: API_PORT,
            method: req.method,
            path: req.url,
            headers: { ...req.headers, host: `${API_HOST}:${API_PORT}` },
        },
        (upstreamRes) => {
            res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
            upstreamRes.pipe(res);
        },
    );
    upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/html' });
        res.end('<html><body>Bad Gateway</body></html>');
    });
    req.pipe(upstream);
}

const server = createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (pathname === '/api') {
        proxyApi(req, res);
        return;
    }
    if (pathname === '/' || pathname === '/app' || pathname === PREFIX) {
        redirectToEntry(res);
        return;
    }
    if (pathname.startsWith(PREFIX)) {
        serveStatic(pathname, res);
        return;
    }
    notFound(res);
});

/**
 * The WebSocket. No `ws` dependency and no framing awareness: the upgrade
 * request is replayed byte-for-byte onto a raw TCP connection to the mock and
 * the two sockets are then glued together, so the handshake response and every
 * frame after it flow through untouched.
 */
server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (pathname !== '/api') {
        socket.destroy();
        return;
    }

    const upstream = connect(API_PORT, API_HOST, () => {
        // rawHeaders keeps the original order and casing, which matters for
        // Sec-WebSocket-* and costs nothing to preserve.
        let head_ = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
            head_ += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
        }
        upstream.write(`${head_}\r\n`);
        // Bytes node already read past the header block, if any.
        if (head?.length) upstream.write(head);

        socket.pipe(upstream);
        upstream.pipe(socket);
    });

    // A dropped socket on either side must take the other down, never crash
    // the process — the reconnect spec kills sockets on purpose.
    const bothDown = () => {
        socket.destroy();
        upstream.destroy();
    };
    upstream.on('error', bothDown);
    socket.on('error', bothDown);
    upstream.on('close', bothDown);
    socket.on('close', bothDown);
});

server.listen(PORT, () => {
    console.log(
        `[calaos-sim] listening on http://localhost:${PORT} — app under ${PREFIX}, ` +
            `/api → ${API_HOST}:${API_PORT}, static root ${DIST}`,
    );
});

const shutdown = () => {
    server.close(() => process.exit(0));
    server.closeAllConnections?.();
    setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
