# Vue 3 Rewrite — Architecture

Target: rewrite the AngularJS 1.8 app as **Vue 3 + Vite + TypeScript**, feature parity plus deliberate fixes, light visual refresh (dark theme, cyan `#38b0d3` accent, tactile press feedback), tested with **Vitest + Playwright**. Task breakdown and status live in [BOARD.md](BOARD.md) and `tasks/`.

## Deployment invariants

- Output is a static site in `dist/`. It is **gitignored, never committed** (it was committed until T22): CI builds it.
- **Git tags are the single source of version truth.** `package.json` carries the literal placeholder `0.0.0-git` and is never hand-bumped. `calaos/action-bump-version@2` takes the highest existing tag (dpkg ordering over `git tag -l`, so `3.0.2-dev.9` < `3.0.2`) and bumps it; the workflow injects the result with `npm version --no-git-tag-version` before building. Tags are bare — no `v` prefix — and keep the `-` of a prerelease (`3.0.2-dev.0`); the `-` → `~` debianization happens downstream in pkgdebs.
- **Every push to `master` auto-publishes a `-dev.N` prerelease.** `.github/workflows/release.yml` runs on `push: master` with the `prerelease` fragment (`3.0.1` → `3.0.2-dev.0` → `3.0.2-dev.1` …). A real release is a manual `workflow_dispatch` with `vincrement` = `major` | `minor` | `patch`; `prerelease` on the GitHub Release is exactly `github.event.inputs.vincrement == ''`, i.e. true for pushes, false for dispatches.
- Delivery is a **GitHub Release asset**: release.yml runs the gates (`needs: ci`, test.yml as a reusable workflow), builds, packages the *contents* of `dist/` as `calaos-web-app-<version>.tar.gz` (`index.html` at the archive root, deterministic `--sort=name --owner=0 --group=0 --numeric-owner`), creates the tag (`negz/create-tag@v1`) and publishes the release (`meeDamian/github-release@2.0`). Then — and only then, because the deb build downloads the asset by tag — it fires a `build_deb` `repository_dispatch` at **calaos/pkgdebs** with `{"pkgname":"calaos-web-app","version":…,"image_src":"","prerelease":…}`, which builds the `calaos-web-app` `.deb` and pushes it to the apt repo at `deb.calaos.fr/calaos`. calaos/calaos_base's Dockerfile is the fallback consumer, downloading the release asset directly. Tags cut before T22 still ship `dist/` inside their source archive.
- Tag/release/dispatch all use `secrets.ACTION_DISPATCH` (an org PAT): `GITHUB_TOKEN` cannot re-trigger workflows from a tag it pushed, nor reach another repo.
- Production is same-origin: the app is served by calaos_server; WS URL is `ws(s)://location.host/api`. (`location.host` omits the colon when the port is empty — this fixes the old `host:/api` bug.)

## Repo layout during the rewrite

New app in `app/` at the repo root, single root `package.json` (no workspaces — one lockfile).

| script | during rewrite | after cutover (T20) |
|---|---|---|
| `npm run dev` / `build` | old `tools/*.js` → `dist/` (committed back then) | `vite` / `vite build` → `dist/` (gitignored since T22, built by CI) |
| `npm run dev:next` / `build:next` / `preview:next` | vite / vite build → `dist-next/` (gitignored) / vite preview | removed |
| `npm run mock` | `node mock-server/index.js` (added T04) | kept |
| `lint` / `typecheck` / `test:unit` / `test:e2e` | added incrementally | kept |

`.gitignore` additions (T01): `dist-next/`, `*.local`, `test-results/`, `playwright-report/`.

## File tree (new code)

```
vite.config.ts            # root:'app', /api proxy, outDir dist-next (dist after cutover)
vitest.config.ts          # happy-dom default, includes app/** and mock-server/*.test.js
playwright.config.ts      # webServer: [mock, vite preview]; testDir e2e/
tsconfig.json / tsconfig.app.json / tsconfig.node.json
e2e/                      # fixtures.ts (mockControl helper) + specs
mock-server/              # index.js, state.js, control.js, fixtures/{home.json,camera.png}, mock-server.test.js
app/
├── index.html
├── public/favicon.svg
└── src/
    ├── main.ts  App.vue
    ├── styles/{theme,base,animations}.css   # design tokens, reset+typo+focus, fade/shake/press
    ├── protocol/          # NO Vue imports in this directory
    │   ├── types.ts       # wire types + IoItem discriminated union on guiType
    │   ├── guards.ts      # hand-written defensive runtime guards (no zod)
    │   ├── messages.ts    # encodeLogin/encodeGetHome/encodeSetState + decodeServerMessage
    │   ├── io-states.ts   # pure per-type state parsers (see table below)
    │   ├── socket.ts      # CalaosSocket: reconnect/backoff/timeout, typed emitter, injectable WebSocket
    │   └── server-url.ts  # wsUrl()
    ├── stores/{connection,auth,home}.ts
    ├── services/{calaos.ts,camera-url.ts}   # camera-url.ts = ONLY place credentials touch a URL
    ├── composables/{useCameraPoll.ts,useIo.ts}
    ├── router/index.ts    # hash history + requiresAuth guard
    ├── i18n/{index.ts,en.json,fr.json}
    ├── components/
    │   ├── chrome/{AppBackground,NavBar,FooterNav,ConnectionBanner}.vue
    │   ├── ui/{BaseDialog,BaseSlider,StateIcon,IconButton,RoomIcon}.vue
    │   ├── dialogs/{ColorPickerDialog,TextInputDialog}.vue
    │   └── io/{IoRow,IoRowFrame,TempIo,AnalogInIo,AnalogOutIo,LightIo,LightDimmerIo,
    │           LightRgbIo,ShutterIo,ShutterSmartIo,VarBoolIo,VarIntIo,VarStringIo,
    │           StringInIo,ScenarioIo,UnknownIo}.vue
    └── views/{LoginView,HomeView,RoomView,AudioListView,AudioPlayerView,
               CameraListView,CameraView}.vue
```

Unit tests are co-located (`foo.ts` → `foo.spec.ts`).

## Protocol layer

Wire messages (all values are STRINGS on the wire):

- send `{"msg":"login","data":{"cn_user":u,"cn_pass":p}}` → recv `{"msg":"login","data":{"success":"true"|"false"}}`
- send `{"msg":"get_home"}` → recv `data: {home:[rooms], cameras:[], audio:[]}`. Room `{name,type,hits,items[]}`; IO `{id,name,gui_type,gui_style?,state,visible,rw,unit}`. Rooms sorted desc by `hits` at ingest.
- send `{"msg":"set_state","data":{"id":ioId,"value":v}}` — v ∈ `'true','false','up','down','stop','inc','dec','set <0-100>','set <#rrggbb>'`, or raw text (string IOs, no prefix).
- recv `{"msg":"event","data":{"type_str":"io_changed","data":{id,state?,name?}}}`.

`guards.ts` converts `visible`/`rw` wire strings to booleans once at ingest; `state` stays a raw string in the store, parsed on demand by `io-states.ts`. Guards never throw on malformed frames (typed fallback + `console.warn`).

### IO state parsers (`io-states.ts`) — faithful transcription of `src/scripts/controllers/io.js`

| gui_type | parse (state → view model) | actions sent |
|---|---|---|
| `temp` | display `state` + (`unit` or `°C`) | — |
| `analog_in` / `string_in` | `state` + `unit` / raw text (empty → show `name`) | — |
| `analog_out` | `state` + `unit`, icon from `gui_style` (fallback `default`) | `inc` / `dec` |
| `light` | on ⇔ `state === 'true'` | `true` / `false` |
| `light_dimmer` | percent: numeric `state` → int; `'set N'` → N; `'true'`→100; `'false'`→0. on ⇔ percent > 0 | `true`/`false`; slider commit-on-release → `set N` |
| `light_rgb` | color = `state === '0' ? '#000' : state`; on ⇔ `!(state==='0' \|\| state==='#000000')` | `true`/`false`; picker → `set #rrggbb` |
| `shutter` | open ⇔ `state === 'true'` | `up`/`down`/`stop` |
| `shutter_smart` | prefix `up`/`down`/`stop` + `' <pct>'` → `{action, percent}`; open ⇔ percent < 100 (numeric compare — fixes old string<number bug; NaN → 0) | `up`/`down`/`stop` |
| `var_bool` | checked ⇔ `state === 'true'` | `true` / `false` |
| `var_int` | `state` + `unit` | `inc` / `dec` |
| `var_string` / `string_out` | display = `state === '' ? name : state` | text dialog → raw text, **no prefix** |
| `scenario` | name only | `true` (play) |
| unknown | icon from `gui_style`, name + state | — |

Cross-cutting (uniform this time, documented intentional fix): `visible === false` → not rendered; `rw === false` → action controls hidden (old code was inconsistent, e.g. analog_out ignored `rw`).

### WS client (`socket.ts`)

Framework-free class, WebSocket constructor injected for tests. Infinite retry, delay 1000 ms ×1.5 per attempt capped at 30 000 ms, 2 s connect timeout (matches old reconnecting-websocket defaults). Typed emitter: `open`, `close`, `message(ServerMessage)`, `statuschange`. **No auth logic here** — login-on-open lives in `services/calaos.ts` and only fires when the auth store holds credentials and the last attempt wasn't a rejection. This kills two old bugs: empty-credential auto-login (shake on page load) and sign-out-on-ws-error. WS errors only drive the connection banner, never navigation.

## Stores (Pinia)

- **connection**: `status: 'connecting'|'open'|'reconnecting'`, `attempt`, `nextRetryMs`; `showBanner` debounced 1 s.
- **auth**: `user`,`pass` in-memory only (no persistence, as today); `state: 'idle'|'pending'|'authed'|'failed'`. `signOut()` clears creds + home store, routes to `/login`, socket stays open.
- **home** (normalized): `rooms: RoomVM[]` (sorted hits desc; `roomId` = index, as today), `ios: Map<string, IoItem>` (single source of truth, rooms reference `ioIds`), `cameras`, `audioPlayers`, `pending: Map<id,{value,sentAt}>`. `handleEvent` is a dispatch table (`io_changed` implemented; `new_io`/`delete_io`/`modify_room`/`new_room`/`delete_room`/`audio_*` are documented stubs) so future events are one entry each.
- **set_state UX**: pending indicator, NOT optimistic UI (many IOs don't echo the sent value verbatim). `sendSetState` records pending, 5 s timeout clears silently; `io_changed` clears it. `useIo(id)` → `{io, isPending, set}`.
- **services/calaos.ts**: singleton glue socket↔stores. On open → re-login if creds retained; on login ok → `get_home`; on get_home → store + router push `/home` (drop the old artificial 1.5 s delay; keep ≥400 ms min-spinner in LoginView).

## Dev server override (dev_config.js successor)

**No VITE_ var in the bundle.** App always uses same-origin `/api`; Vite dev/preview proxy forwards it. `vite.config.ts` reads a non-VITE env var via `loadEnv`:

```
# .env.development.local (gitignored via *.local)
CALAOS_SERVER=http://192.168.30.17:5454
```

Default proxy target is the mock server (`http://localhost:5454`), so `npm run dev:next` + `npm run mock` is a fully offline loop. Belt-and-braces: `vite.config.ts` throws if `mode === 'production'` and any `VITE_CALAOS*` var is set. Camera URLs are relative (`/api?...`) so the proxy covers them too — no SCE-whitelist analog.

## Router

`createWebHashHistory` (deep-link reloads must work on dumb static servers — calaos_server and static-web-server have no SPA fallback). Routes: `/login`, `/home`, `/home/:roomId(\d+)`, `/audio`, `/audio/:playerId`, `/security`, `/security/:cameraId(\d+)`; all but login `meta.requiresAuth`. Guard: unauthenticated → `/login`; out-of-bounds index params → redirect to parent list. NavBar back button on the three detail routes (`meta.detail`).

## Styling / icons / fonts (light refresh)

- Plain CSS + custom properties + scoped SFC styles (no Tailwind/preprocessor — old app is 891 lines of CSS). Tokens: `--c-bg:#000`, `--c-accent:#38b0d3`, surfaces, glow, spacing/radius, `--press-scale:.94`. Global `.pressable:active{transform:scale(var(--press-scale))}` + `prefers-reduced-motion` guard.
- Grids: `display:grid; grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))` — replaces the JS 3-per-row chunking. Breakpoints ~480/768/1100 px.
- Icons: `unplugin-icons` + `@iconify-json/mdi` (compile-time tree-shaken SVG). `RoomIcon.vue` maps room type → MDI icon (replaces `getRoomTypeIcon` and its implicit-global bug). `StateIcon.vue` = two stacked SVGs with opacity crossfade (the old sprite-crossfade feel). Sign-out = `mdi:logout` (old `fa-sign-out` was invalid in FA5).
- Fonts: `@fontsource/ubuntu` woff2. Color picker: `@ckpack/vue-color`, wrapped in `ColorPickerDialog.vue` — its ONLY contract is `confirm('#rrggbb')`.
- Background: reuse `background.png`, fade on its own `load` event. The 62-image preloader + `assets.json` are dropped entirely.

## Camera polling (`useCameraPoll.ts`)

`<img>`-based, no canvas: `src = cameraSnapshotUrl(id) + '&t=' + Date.now()`; on load schedule next after 250 ms (old code: 10 ms + Angular digest storm); on error exponential backoff 1→10 s, after 3 consecutive errors expose `error:true` → broken-camera placeholder with retry. Pause on `document.hidden`, stop on unmount. Snapshot URL shape (server constraint, credentials in query string — isolated in `camera-url.ts`): `/api?cn_user=..&cn_pass=..&action=camera&type=get_picture&id=..`.

## i18n

vue-i18n (composition, `legacy:false`). Locale: `navigator.language.startsWith('fr') ? 'fr' : 'en'`, fallback en. ~25 chrome strings + `roomType.*` keys seeded from old `utils.js` French names. Server-provided room/IO names are user data — never translated.

## Mock calaos_server (`mock-server/`)

Plain Node ≥18 ESM, single dep `ws`, one HTTP server on PORT (default 5454):

1. **WS `/api`**: `login` (valid creds `demo`/`demo`, env-overridable), `get_home` from `fixtures/home.json` (covers ALL 14 gui_types with realistic states — `shutter_smart:"up 100"`, dimmer `"set 50"`, rgb `"#ff2200"`, empty var_string — unsorted `hits`, one `visible:"false"` IO, one `rw:"false"` IO, 2 cameras, 1 audio player), `set_state` applies naive transitions then **broadcasts `io_changed`** to all clients.
2. **HTTP `/api?action=camera&type=get_picture&id=..`**: validates creds, returns `fixtures/camera.png`, 403 on bad creds.
3. **HTTP POST `/control`** (test API): `{op:'push_io',id,state}` · `{op:'drop'}` (kill sockets) · `{op:'scenario',name}` (`login_fail_once`|`silent_login`|`reject_all_logins`|`reset`) · `{op:'latency',ms}` · `{op:'log'}` (every received frame — E2E asserts exact `set_state` frames) · `{op:'reset'}`.

## Testing strategy

- **Unit (Vitest, happy-dom)**: `io-states` table-driven per type (the crown jewel), guards/messages codecs, socket backoff sequence with fake timers + injected WS, `wsUrl` empty-port regression, stores (auth machine incl. no-empty-cred-login, normalization/sort, io_changed patch, pending lifecycle), `useCameraPoll` fake timers, component tests (IoRow dispatch ×14+unknown, visible/rw gating, slider commits once on release, dialog contracts).
- **E2E (Playwright, chromium + mobile project)**: against **built** app (`vite preview`) + mock via `webServer`; preview proxy forwards `/api` so E2E exercises production URL derivation. Specs: login ok/fail, no auto-login on cold load (`/control log` shows zero login frames), room nav, IO roundtrips with exact-frame assertions, `push_io` live update, `drop` → banner → auto-reconnect → re-login, cameras polling, fr-locale smoke.

## Audio (full player — user decision)

The old audio player is a non-functional stub with no protocol behind it. T16 researches the real calaos_server JSON/WS audio protocol (repo `calaos/calaos_base`, e.g. `src/bin/calaos_server/JsonApi*` — commands play/pause/stop/next/prev, volume, `audio_status`/`audio_volume`/`audio songchanged` events, cover art) and writes `docs/audio-protocol.md` + extends the mock server. T17 implements the player against that spec.

## Execution rules for task subagents

1. Never modify `src/`, `tools/`, `dist/` (they are the live old app) — exceptions listed per task.
2. Every task's AC includes `npm run lint` and `npm run typecheck` green, plus the task's own test commands.
3. Real-server smoke tests use `.env.development.local` with `CALAOS_SERVER=http://192.168.30.17:5454` (never committed).
4. Do not commit or push — the operator reviews, re-runs AC, commits (one commit per task), and updates BOARD.md.
