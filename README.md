Webapp for Calaos
-----------------

Web frontend for the [Calaos](https://calaos.fr) home automation server: a
Vue 3 + TypeScript single-page app (built with Vite) that talks to
calaos_server over its WebSocket JSON API — rooms, lights, shutters,
scenarios, cameras and audio players.

Requirements: Node.js >= 20.19.

## Develop

```
npm install
```

Fully offline, against the bundled mock calaos_server (log in with
`demo` / `demo`):

```
npm run mock     # terminal 1 — mock calaos_server on :5454
npm run dev      # terminal 2 — app on http://localhost:5173
```

Against a real calaos_server, create `.env.development.local` (gitignored,
never committed):

```
CALAOS_SERVER=http://192.168.1.10:5454
```

then `npm run dev` — the dev server proxies same-origin `/api` (WebSocket +
camera HTTP) to that host. The app itself always talks to same-origin
`/api`; in production it is served by calaos_server directly.

## Build

```
npm run build
```

regenerates `dist/`. It is build output only: **gitignored, never
committed** — released artifacts are built by CI (see Release below).
`npm run preview` serves the built `dist/` locally (same `/api` proxy rules
as dev).

## Test

```
npm run lint
npm run typecheck
npm run test:unit                          # Vitest
npx playwright install chromium            # once
npm run test:e2e                           # Playwright (builds + serves dist/, starts the mock itself)
```

## Release

Bump `"version"` in `package.json`, push to `master`, then dispatch the
release workflow — `/release 3.0.1` from Claude Code, or by hand:

```
gh workflow run release.yml -f version=3.0.1
```

The workflow re-runs every gate, builds the app, and publishes a GitHub
Release tagged `3.0.1` (bare version, no `v` prefix) whose only asset is
`calaos-web-app-3.0.1.tar.gz` — the contents of `dist/`, `index.html` at the
archive root. It creates the tag itself; never tag by hand.

Consumers install a release by fetching that asset, e.g.

```
curl -fsSL https://github.com/calaos/calaos-web-app/releases/download/3.0.1/calaos-web-app-3.0.1.tar.gz \
  | tar xz -C /path/to/webroot
```
