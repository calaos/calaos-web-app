# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Web frontend for the Calaos home automation server: Vue 3 + TypeScript + Vite, Pinia stores, vue-router (hash history — static servers have no SPA fallback), vue-i18n (en/fr), unplugin-icons (MDI), plain CSS with custom properties (no Tailwind, no preprocessor, no formatter). App code lives in `app/src/`; unit tests are co-located (`foo.ts` → `foo.spec.ts`). Architecture details: `docs/ARCHITECTURE.md`.

## dist/ is committed and is the sole input to Docker/packaging

- CI never builds. `docker-publish.yml` copies the committed `dist/` into the image; the calaos/pkgbuilds PKGBUILD packages it too. **Any change under `app/` must ship with a fresh `npm run build` and the resulting `dist/` in the same commit**, or production gets stale code.
- Never hand-edit `dist/`; `npm run build` empties and regenerates it. `npm run test:e2e` also rebuilds `dist/` (Playwright's webServer runs `npm run build` + `vite preview`), producing identical output for identical sources.

## Networking invariants

- The app always talks to **same-origin `/api`** (WebSocket + camera snapshots); in production it is served by calaos_server itself. The WS URL is derived from `location.host` (`app/src/protocol/server-url.ts`) — never ship a hardcoded host, and no `VITE_*` var may reach the bundle (`vite.config.ts` refuses production builds if `VITE_CALAOS*` is set).
- Dev against a real server: put `CALAOS_SERVER=http://<host>:5454` in `.env.development.local` (gitignored, never commit it); the Vite dev/preview proxy forwards `/api` there. Default target is the mock server.
- `npm run mock` starts the mock calaos_server on :5454 (creds `demo`/`demo`, test API on `POST /control`) — `npm run mock` + `npm run dev` is a fully offline loop.

## Protocol layer

`app/src/protocol/` (types, guards, message codecs, per-gui_type state parsers, WS client) has **no Vue imports** — keep it framework-free. All wire values are strings; guards never throw on malformed frames. The audio protocol spec is `docs/audio-protocol.md` — items marked "Unverified" there have not been validated against a real calaos_server yet.

## npm scripts

`dev` / `build` / `preview` (Vite), `mock`, `lint` (eslint, repo-wide, must stay clean), `typecheck` (vue-tsc), `test:unit` (Vitest), `test:e2e` (Playwright; starts mock + build/preview itself, needs `npx playwright install chromium` once). Node >= 20.19.

## Known gaps

- Color picker: the hue bar is not keyboard-accessible (upstream `@ckpack/vue-color` limitation).

## Git & releases

- Commit directly to `master` — no PRs. Pushing to master dispatches a package build to calaos/calaos-build and publishes the Docker image, so never push with a stale or broken `dist/`.
- The version lives in `package.json` only.
- Releases are cut with `gh workflow run build_release.yml -f version=x.x.x` (dev builds: `build_dev.yml` with `x.x.x-dev`). The workflow creates the git tag itself — never create release tags manually. Use the `/release` skill.
