# Vue 3 Rewrite — Architecture

Target: rewrite the AngularJS 1.8 app as **Vue 3 + Vite + TypeScript**, feature parity plus deliberate fixes, light visual refresh (dark theme, cyan `#38b0d3` accent, tactile press feedback), tested with **Vitest + Playwright**. Task breakdown and status live in [BOARD.md](BOARD.md) and `tasks/`.

## Deployment invariants

- Output is a static site in `dist/`. It is **gitignored, never committed** (it was committed until T22): CI builds it.
- **Git tags are the single source of version truth.** `package.json` carries the literal placeholder `0.0.0-git` and is never hand-bumped. `calaos/action-bump-version@2` takes the highest existing tag (dpkg ordering over `git tag -l`, so `3.0.2-dev.9` < `3.0.2`) and bumps it; the workflow injects the result with `npm version --no-git-tag-version` before building. Tags are bare — no `v` prefix — and keep the `-` of a prerelease (`3.0.2-dev.0`); the `-` → `~` debianization happens downstream in pkgdebs.
- **Every push to `master` auto-publishes a `-dev.N` prerelease.** `.github/workflows/release.yml` runs on `push: master` with the `prerelease` fragment (`3.0.1` → `3.0.2-dev.0` → `3.0.2-dev.1` …). A real release is a manual `workflow_dispatch` with `vincrement` = `major` | `minor` | `patch`; `prerelease` on the GitHub Release is exactly `github.event.inputs.vincrement == ''`, i.e. true for pushes, false for dispatches.
- Delivery is a **GitHub Release asset**: release.yml runs the gates (`needs: ci`, test.yml as a reusable workflow), builds, packages the *contents* of `dist/` as `calaos-web-app-<version>.tar.gz` (`index.html` at the archive root, deterministic `--sort=name --owner=0 --group=0 --numeric-owner`), creates the tag (`negz/create-tag@v1`) and publishes the release (`meeDamian/github-release@2.0`). Then — and only then, because the deb build downloads the asset by tag — it fires a `build_deb` `repository_dispatch` at **calaos/pkgdebs** with `{"pkgname":"calaos-web-app","version":…,"image_src":"","prerelease":…}`, which builds the `calaos-web-app` `.deb` and pushes it to the apt repo at `deb.calaos.fr/calaos`. calaos/calaos_base's Dockerfile is the fallback consumer, downloading the release asset directly. Tags cut before T22 still ship `dist/` inside their source archive.
- Tag/release/dispatch all use `secrets.ACTION_DISPATCH` (an org PAT): `GITHUB_TOKEN` cannot re-trigger workflows from a tag it pushed, nor reach another repo.
- Production is same-origin: the app is served by calaos_server; WS URL is `ws(s)://location.host/api`. (`location.host` omits the colon when the port is empty — this fixes the old `host:/api` bug.)
- **The app is served under the `/app/` prefix, not at the origin root, so `base` in `vite.config.ts` MUST stay `'./'`.** calaos_server's router (calaos_base `src/bin/calaos_server/HttpClient.cpp`) 301s `/`, `/app` and `/app/` to `/app/index.html`, serves static files only for paths under `/app/`, routes `/api` to the API (HTTP actions + WS upgrade), and answers **everything else with a 404 whose Content-Type is `text/html`**. With vite's default `base: '/'` the built `index.html` asks for `/assets/index-*.js`, which escapes the prefix, gets that 404 page, and the browser refuses to execute it (`MIME type of text/html is not a valid JavaScript MIME type`) — a blank app. The AngularJS predecessor only survived because its asset paths happened to be relative. `'./'` resolves against the document, so one bundle works both under `/app/` and at the root (`vite dev`, `vite preview`, the E2E rig). The app's own `/api` URLs stay **absolute** — the API really is at the server root, and `location.host`-derived WS URLs are unaffected. Public-dir assets (`favicon.svg`) keep their canonical absolute `/favicon.svg` reference in `app/index.html`; vite rewrites them through `base` at build time. Regression: `e2e/app-prefix.spec.ts` against `e2e/calaos-server-sim.mjs`, which reproduces that router.

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
playwright.config.ts      # webServer: [mock, build+vite preview, calaos-server-sim]; testDir e2e/
tsconfig.json / tsconfig.app.json / tsconfig.node.json
e2e/                      # fixtures.ts (mockControl helper) + specs + calaos-server-sim.mjs
mock-server/              # index.js, state.js, control.js, fixtures/{home.json,camera.png}, mock-server.test.js
app/
├── index.html
├── public/favicon.svg
└── src/
    ├── main.ts  App.vue
    ├── styles/{theme,base,animations}.css   # design tokens, reset+typo+focus, fade/shake/press
    ├── assets/rooms/*.png    # the original room artwork (RoomIcon)
    ├── assets/io/*           # device + battery/wifi artwork, from calaos/calaos_mobile
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
    │   ├── ui/{BaseDialog,BaseSlider,StateIcon,IconButton,RoomIcon,ImageIcon,MaskIcon}.vue
    │   ├── dialogs/{ColorPickerDialog,TextInputDialog}.vue
    │   └── io/{IoRow,IoRowFrame,TempIo,AnalogInIo,AnalogOutIo,LightIo,LightDimmerIo,
    │           LightRgbIo,ShutterIo,ShutterSmartIo,VarBoolIo,VarIntIo,VarStringIo,
    │           StringInIo,ScenarioIo,UnknownIo,SensorStatusBadge}.vue
    │           + light-styles.ts (io_style -> device), io-style-icons.ts, action-icons.ts
    └── views/{LoginView,HomeView,RoomView,AudioListView,AudioPlayerView,
               CameraListView,CameraView}.vue
```

Unit tests are co-located (`foo.ts` → `foo.spec.ts`).

## Protocol layer

Wire messages (all values are STRINGS on the wire):

- send `{"msg":"login","data":{"cn_user":u,"cn_pass":p}}` → recv `{"msg":"login","data":{"success":"true"|"false"}}`
- send `{"msg":"get_home"}` → recv `data: {home:[rooms], cameras:[], audio:[]}`. Room `{name,type,hits,items[]}`; IO `{id,name,gui_type,io_style?,state,visible,rw?,unit,status_info?}`. Rooms sorted desc by `hits` at ingest.
- **`io_style`, not `gui_style`.** calaos_server's parameter whitelist (`JsonApi::buildJsonIO`) carries `io_style`; it never sends `gui_style`, which is what the AngularJS templates read. `guards.ts` prefers `io_style` and keeps `gui_style` as a fallback. For a `light` the style is the DEVICE — `outlet`, `pump`, `heater`, `boiler` — and each is drawn as itself (`components/io/light-styles.ts`, ported from calaos_mobile's `Common::IOTypeFromString`); for the analog types it picks the dial glyph.
- **`status_info`** is per-IO device telemetry (`battery_level`, `wireless_signal`, `connected`, `uptime`, `ip_address`, `wifi_ssid`), present only on IOs that are radios or run on a battery. `SensorStatusBadge.vue` renders it on every row, using calaos_mobile's `SensorStatusIcon.qml` priority and thresholds: disconnected > battery ≤ 30 (both blink) > battery > signal, and nothing at all when the device reports neither battery nor signal.
- send `{"msg":"set_state","data":{"id":ioId,"value":v}}` — v ∈ `'true','false','up','down','stop','inc','dec','set <0-100>','set <#rrggbb>'`, or raw text (string IOs, no prefix).
- recv `{"msg":"event","data":{"type_str":"io_changed","data":{id,state?,name?}}}`.

`guards.ts` converts `visible`/`rw` wire strings to booleans once at ingest; `state` stays a raw string in the store, parsed on demand by `io-states.ts`. Guards never throw on malformed frames (typed fallback + `console.warn`).

### IO state parsers (`io-states.ts`) — faithful transcription of `src/scripts/controllers/io.js`

| gui_type | parse (state → view model) | actions sent |
|---|---|---|
| `temp` | display `state` + (`unit` or `°C`) | — |
| `analog_in` / `string_in` | `state` + `unit` / raw text (empty → show `name`) | — |
| `analog_out` | `state` + `unit`, icon from `io_style` (fallback `default`) | `inc` / `dec` |
| `light` | on ⇔ `state === 'true'` | `true` / `false` |
| `light_dimmer` | percent: numeric `state` → int; `'set N'` → N; `'true'`→100; `'false'`→0. on ⇔ percent > 0 | `true`/`false`; slider commit-on-release → `set N` |
| `light_rgb` | color = `state === '0' ? '#000' : state`; on ⇔ `!(state==='0' \|\| state==='#000000')` | `true`/`false`; picker → `set #rrggbb` |
| `shutter` | open ⇔ `state === 'true'` | `up`/`down`/`stop` |
| `shutter_smart` | prefix `up`/`down`/`stop` + `' <pct>'` → `{action, percent}`; open ⇔ percent < 100 (numeric compare — fixes old string<number bug; NaN → 0) | `up`/`down`/`stop` |
| `var_bool` | checked ⇔ `state === 'true'` | `true` / `false` |
| `var_int` | `state` + `unit` | `inc` / `dec` |
| `var_string` / `string_out` | display = `state === '' ? name : state` | text dialog → raw text, **no prefix** |
| `scenario` | name only | `true` (play) |
| `climate` | everything from `device` (see below); `state` is only the mode, shown when there is no usable `device` | plain mode; JSON partial update |
| unknown | icon from `io_style`, name + state | — |

Cross-cutting: `visible === false` → not rendered, uniformly, for every type (a documented intentional fix — the old templates checked it inconsistently).

### The `climate` row (`ClimateIo.vue`)

One component for the whole device family, driven by `device.capabilities` (which controls exist) and `device.state` (what they show); nothing branches on `impl`. A device without a usable `device` object renders as a name and its scalar mode, with no controls. The design is `docs/devices/UI_CLIMATE.md` in calaos_base.

- **The row** only reads: a mini dial, the name, the setpoint (`21 – 23°` in auto, none in `fan_only`), the room's temperature and a status, with a chevron. The whole row is the button (`IoRowFrame` `opens`); there is no −/+ in it.
- **The settings** (`ClimateDetail.vue`: dial, − 22° +, mode pill, "More settings") open in a side panel at ≥ 1024 px (`RoomView` shifts the list left through `room--panel`, state in `useClimatePanel`) and in a wide centred `BaseDialog` below. The mode and the secondary settings (fan, swing, humidity) are `BaseDialog`s on top. "More settings" exists only if the device has fan or swing modes, or a humidity reading.
- **Status** (`climateStatus`, `protocol/climate.ts`): offline (`connected: false`) > fault > mode unknown / off > lock-out > the reported action. A device that reports no action shows its mode. Colours: heating `--c-heat`, cooling and drying `--c-accent`, lock-out `--c-warn`, offline and fault `--c-danger`, the rest neutral. `lockout`, `connected`, `fault` and `humidity` (CLIM-6) are optional in the decoded state; the lock-out countdown is local, from `remaining`.
- **Gating** (`climateGating`): `fan_only` hides the setpoint; the two-handle range replaces the single setpoint only in `auto` on a device with `target_temp_range`. A device that exposes only low/high (range capability, no `ios.target_temp`) shows the range in every mode but `fan_only`; a half-known range is shown but not editable, because the server refuses partial ranges. −/+ are refused while the device is offline or its mode unknown, not while it is `off`.
- **Range**: the server refuses a low/high pair tighter than `min_range` whole, so the buttons go through `moveRangeHandle`; at the stop the two inner buttons are disabled and the panel says "Minimum gap 2°".
- **Commands** (`useClimate`): choosing a mode sends the plain mode. Setpoint, range, fan and swing changes are queued and sent as one JSON partial update after 350 ms of quiet (`useDebouncedMerge`), so a run of +/- taps is one command. Choosing a mode flushes the queue first.
- **Not optimistic, with one exception**: a value the user just chose (the draft) stays on screen until the server reports another value for that field, refuses the command, or 5 s pass; an `io_changed` that only moves `current_temp` does not end it.

### The `rw` flag

**`rw` is not a general read-only flag, and only three gui_types may gate on it.** Getting this wrong is what made almost every actuator in a real house uncontrollable after the rewrite, so the rule is spelled out here once:

- calaos_server builds each IO from a fixed parameter whitelist and **skips any key the object does not define** (`JsonApi::buildJsonIO`: `if (!io->get_params().Exists(param)) continue;`). The only class defining `rw` is `Internal` — `var_bool` / `var_int` / `var_string` — where it is the configurable *"enable edit mode"* flag (`IntValue.cpp`, default `"false"`). For every other gui_type the key is **absent from the wire**, so `guards.ts` reads it as `false`; that false says nothing about whether the IO can be commanded.
- The reference client agrees (calaos/calaos_mobile, kept up to date): `RoomModel.cpp` parses `rw` as `== "true"`, and only `IOVarBool.qml`, `IOVarInt.qml`, `IOVarString.qml` bind a control's visibility to it. `IOLight`, `IOLightDimmer`, `IOLightRGB`, `IOShutter`, `IOShutterSmart`, `IOScenario` never mention it.

| gui_type | gates controls on `rw`? | |
| --- | --- | --- |
| `var_bool`, `var_int` | **yes** | the flag's only real meaning |
| `var_string` | **yes**, but `string_out` shares the component and is always writable | calaos_mobile: `visible: (rw \|\| ioType === StringOut) && ioType !== StringIn` |
| `analog_out` | **no** — always writable | calaos_mobile force-sets `rw = true` for it (*"force rw for analog_out to let us use the same qml than var_int"*) |
| `light`, `light_dimmer`, `light_rgb`, `shutter`, `shutter_smart`, `scenario` | **no** — always writable | an output is commandable by definition |
| `temp`, `analog_in`, `string_in` | n/a | sensors, no actions at all |

The mock fixtures deliberately mirror this: `rw` is **absent** on every type the server omits it for, and present only on the three `Internal` types (`output_8`/`output_9` writable, `output_19` not). A fixture that sets `rw: "true"` everywhere is what let the regression pass CI.

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

**Origin.** Once an admin is set, calaos_server refuses any `Origin` not on its allow-list (WS handshake and HTTP `/api.php`), and accepts an absent one. The proxy therefore drops the `Origin` of the dev page itself (`dev-proxy-origin.ts`: same host as the request, `localhost` or an IP literal only), so nothing has to be configured on the box. Any other `Origin` (cross-site page, DNS-rebound name) is forwarded untouched and the server still refuses it. `changeOrigin` sets `Host` to the target.

## Router

`createWebHashHistory` (deep-link reloads must work on dumb static servers — calaos_server and static-web-server have no SPA fallback). Routes: `/login`, `/home`, `/home/:roomId(\d+)`, `/audio`, `/audio/:playerId`, `/security`, `/security/:cameraId(\d+)`, `/admin` (lazy chunk, unlocked: only the tiles and the info banner), its sub-pages `/admin/{updates,network,services,logs,time,mcp,security,system,settings,console}` (lazy, detail; xterm.js in its own chunk, imported by the view; without an unlocked admin session → `/admin`); all but login `meta.requiresAuth`. Guard: unauthenticated → `/login`; out-of-bounds index params → redirect to parent list. NavBar back button on the three detail routes (`meta.detail`).

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
3. **HTTP POST `/control`** (test API): `{op:'push_io',id,state}` · `{op:'drop'}` (kill sockets) · `{op:'scenario',name}` (`login_fail_once`|`silent_login`|`reject_all_logins`|`reset`) · `{op:'latency',ms}` · `{op:'log'}` (every received frame — E2E asserts exact `set_state` frames) · `{op:'admin',…}` / `{op:'admin_status'}` / `{op:'console',…}` / `{op:'credentials',user,pass}` (below) · `{op:'reset'}`.
4. **Admin** (`admin.mjs`): `admin_unlock` / `admin_set` / `admin` / `admin_event` and `settings`/`change_cred`, per the contract in calaos_base `docs/08_http_api.md` "Administration" — session tokens, the `bad_session` / `admin_not_set` / `household_password_required` rules, a 5-failures-per-minute limiter, and a timer-driven upgrade (`upgrade_progress` events in 10 % steps over `upgradeMs`, `dropAtPercent` cuts every socket once like calaos-server restarting itself, `failAtPercent` ends in error). `{op:'admin', scenario}` answers every admin message with one contract error (`unavailable`, `daemon_too_old`, `https_required`, `daemon_unreachable`) or, for `old_server`, never answers at all.
   Approvers and push codes follow calaos-container `docs/API.md` (one pending code per session, `codeIntervalMs` between two, 5 wrong codes end the session, `approver_last`, two approvers at most). A code "pushed" to a phone is recorded in `admin_status.pushed`, which is how E2E reads it; `{op:'admin', approvers:[token_id or {token_id, device_name}…], pushTokens, codeTtlMs, codeIntervalMs, expireCodes, alerts, noiseEvents}` seeds the state; a code for a phone whose token is not in `pushTokens` is made but never pushed, and `noiseEvents` buries the alerts under IO history. Approver alerts land in `eventlog` as calaos_server stores them (push-notification event, fixed English prefix, quoted name).
5. **Console** (`console.mjs`): `/api/console` with the `calaos-console.v1` subprotocol, the open message checked like calaos_server does (household credentials, session, the one-time grant left by `admin {console_open}`, two consoles at most), refusals as an error message then `1008`, then an echo shell. `{op:'console', close, expiresIn, idleTimeout, maxConsoles, refuseUpgrade}` drives it and answers what it saw (URLs, open-message keys, inputs and resizes; never the values).

## Admin (`stores/admin.ts`, `views/AdminView.vue`)

calaos_server keeps no admin state: the `admin_session` lives in this store (memory only) and is resent with every message that needs one, so it survives a server restart. `admin {update_status}` needs no session and is the probe for everything (gate, upgrade state); it carries the session whenever one is held, since without it calaos_server answers the household view (no package names, generic error), and `upgrade_progress` events are always that view; it runs when the tab opens, after every login (reconnects included), every 5 s while a job runs, and on the retry cadences of the contract (`admin_unavailable`: 5 s for 2 min then 60 s; `daemon_too_old` / `daemon_unreachable`: growing delay, "restart the box" after 2 min). Replies are correlated by `msg_id` with the contract's timeouts (5 s, 125 s for `update_check`); no reply means an old calaos_server, a dropped socket is not (the reconnect probes again). `bad_session` asks for the password again with no error and replays the refused action, except an upgrade. The gate is one screen at a time: household password first (factory `user`/`pass`), choose the admin password, unlock, or a notice to wait on.

**Approver phones** (`stores/approvers.ts`, `ApproversPanel.vue`, `CodeEntry.vue`). Every protected flow ends in one code entry: enrolment (the first phone gets its own code; a second one first needs a code from an enrolled phone), removal (`approver_last` explained, with the SSH reset), and the admin password change (a `code_request` bound to the new password, then `admin_set` with `code_id`/`code`; without an approver the server answers `approver_required`). Every `code_request` names its phone (`approver_id`): the one seen most recently whose push token is still known, the other one for a removal, and "send it to the other phone" switches; the daemon's default (the oldest) would lose every code to a dead token. A `code_required` from a list read before another client enrolled a phone restarts the enrolment from the approval. Requests go through `admin.relay()`, so gate errors (`bad_session`…) behave as everywhere else; the fifth wrong code drops the session at once. **Sign-in banner** (`stores/adminAlerts.ts`, `AdminAlertBanner.vue`): after each login and each live `approver_set`/`approver_removed`, `eventlog` is read for those alerts (the live event has no name). The log has no type filter and holds the IO history too, so the reader walks back 100 events a page until the 30-day window is covered, 20 pages at most (`admin_alerts:<walk>:<page>`; an older walk's answers are dropped). Dismissals are kept per browser in `localStorage`. The client's own change is not reported back: its alert is the oldest one that was not there before the change, under the name as the box rewrites it. Device names are rendered isolated (`<bdi>`, `DeviceName.vue`) and clamped.

**Console** (`views/ConsoleView.vue`, `protocol/console.ts`). Admin tab → System → Console → a `console_open` code through the approvers store's code entry → `admin {console_open}` turns it into a one-time right valid 30 s → the terminal is built (its size goes into the open message) and `/api/console` opened. Credentials, `admin_session` and `code_id` go in the first message only, never in the URL, and the connection drops them once sent. The server closes with `1001` for the hour, the idle delay and the box's own reasons alike: the first two are told apart by the clock (`ready.expires_in`, `idle_timeout`, last input). A `1006` before `ready` is a refused upgrade (plain http or Origin), which the browser cannot see. Leaving the route closes the socket with `1000`; an open console outlives the admin session (its limits are the daemon's).

## Testing strategy

- **Unit (Vitest, happy-dom)**: `io-states` table-driven per type (the crown jewel), guards/messages codecs, socket backoff sequence with fake timers + injected WS, `wsUrl` empty-port regression, stores (auth machine incl. no-empty-cred-login, normalization/sort, io_changed patch, pending lifecycle), `useCameraPoll` fake timers, component tests (IoRow dispatch ×14+unknown, visible/rw gating, slider commits once on release, dialog contracts).
- **E2E (Playwright, chromium + mobile project)**: against **built** app (`vite preview`) + mock via `webServer`; preview proxy forwards `/api` so E2E exercises production URL derivation. Specs: login ok/fail, no auto-login on cold load (`/control log` shows zero login frames), room nav, IO roundtrips with exact-frame assertions, `push_io` live update, `drop` → banner → auto-reconnect → re-login, cameras polling, fr-locale smoke.
  - A third `webServer`, `e2e/calaos-server-sim.mjs` (:4180), reproduces calaos_server's URL router — app under `/app/`, `/api` piped to the mock (raw TCP for the WS upgrade, no `ws` dependency), `text/html` 404 for everything else. It must stay **last** in the `webServer` array: it serves `dist/` off disk and the preview entry in front of it is what builds it (Playwright awaits one webServer setup task per entry, in array order). `e2e/app-prefix.spec.ts` (chromium-desktop only) boots through it, signs in over the proxied WebSocket, and asserts `index.html` references `./assets/…` while that same asset 404s at the root — the deployment invariant above, encoded.

## Audio (full player — user decision)

The old audio player is a non-functional stub with no protocol behind it. T16 researches the real calaos_server JSON/WS audio protocol (repo `calaos/calaos_base`, e.g. `src/bin/calaos_server/JsonApi*` — commands play/pause/stop/next/prev, volume, `audio_status`/`audio_volume`/`audio songchanged` events, cover art) and writes `docs/audio-protocol.md` + extends the mock server. T17 implements the player against that spec.

## Execution rules for task subagents

1. Never modify `src/`, `tools/`, `dist/` (they are the live old app) — exceptions listed per task.
2. Every task's AC includes `npm run lint` and `npm run typecheck` green, plus the task's own test commands.
3. Real-server smoke tests use `.env.development.local` with `CALAOS_SERVER=http://192.168.30.17:5454` (never committed).
4. Do not commit or push — the operator reviews, re-runs AC, commits (one commit per task), and updates BOARD.md.
