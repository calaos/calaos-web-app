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

regenerates `dist/`, which is **committed to git** and is the sole input to
the Docker image and the distro package — CI never builds. Every app change
must ship as source change **plus** rebuilt `dist/` in the same commit, or
production gets stale code. `npm run preview` serves the built `dist/`
locally (same `/api` proxy rules as dev).

## Test

```
npm run lint
npm run typecheck
npm run test:unit                          # Vitest
npx playwright install chromium            # once
npm run test:e2e                           # Playwright (builds + serves dist/, starts the mock itself)
```

## Release

Releases are cut with `gh workflow run build_release.yml -f version=x.x.x`
(the workflow creates the git tag itself). See CLAUDE.md for details.
