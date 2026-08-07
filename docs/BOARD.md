# Vue 3 Rewrite — Task Board

Source of truth for the rewrite progress. One row per task; details in [`tasks/`](tasks/). Status: ⬜ todo · 🟨 in progress · ✅ done (with commit hash) · ⛔ blocked.

Execution: each task runs in a dedicated subagent (model/effort/skills per its task file), is verified against its acceptance criteria, then committed (one commit per task) and marked ✅ here. Architecture reference: [ARCHITECTURE.md](ARCHITECTURE.md).

## M1 — Scaffold + login (demo: log into mock server)

| ID | Task | Status | Deps | Agent | Commit |
|---|---|---|---|---|---|
| [T01](tasks/T01-scaffold.md) | Scaffold Vite/TS/Vitest/ESLint + styled hello | ✅ | — | sonnet/medium | dd06b94 |
| [T02](tasks/T02-protocol.md) | Protocol types, guards, codecs, IO state parsers | ✅ | T01 | fable/high | 823d3cb |
| [T03](tasks/T03-socket.md) | CalaosSocket + wsUrl | ✅ | T02 | opus/medium | e7400f6 |
| [T04](tasks/T04-mock-server.md) | Mock calaos_server + /control + fixtures | ✅ | T01 | opus/medium | 8b4f551 |
| [T05](tasks/T05-stores.md) | Pinia stores + calaos service wiring | ✅ | T02,T03 | opus/high | fff34c9 |
| [T06](tasks/T06-shell.md) | App shell, router, chrome | ✅ | T05 | opus/medium + frontend-design | 79a511d |
| [T07](tasks/T07-login.md) | Login screen + flow | ✅ | T06 | opus/medium + frontend-design | 4d3bc9b |
| [T08](tasks/T08-e2e-infra.md) | Playwright infra + M1 E2E | ✅ | T04,T07 | opus/medium | 005f306 |

## M2 — Home, rooms, all IOs (demo: full control of mock home)

| ID | Task | Status | Deps | Agent | Commit |
|---|---|---|---|---|---|
| [T09](tasks/T09-home-room.md) | Home grid + Room view shell | ✅ | T06 | opus/medium + frontend-design | bd14d38 |
| [T10](tasks/T10-io-simple.md) | IoRow dispatcher + simple IOs + StateIcon | ✅ | T09,T02 | opus/high + frontend-design | 9d8f41d |
| [T11](tasks/T11-io-sliders.md) | Slider/stepper IOs (dimmer, analog_out, var_int) | ✅ | T10 | sonnet/medium | 9fb5e91 |
| [T12](tasks/T12-io-dialogs.md) | BaseDialog + color picker + text dialog IOs | ✅ | T10 | opus/medium + frontend-design | 9fb5e91 |
| [T13](tasks/T13-io-shutters.md) | Shutter IOs (shutter, shutter_smart) | ✅ | T10 | sonnet/medium | 9fb5e91 |
| [T14](tasks/T14-e2e-io.md) | E2E IO interaction suite | ✅ | T08,T11,T12,T13 | opus/medium | f60f8a9 |

## M3 — Cameras + audio (demo: full feature surface)

| ID | Task | Status | Deps | Agent | Commit |
|---|---|---|---|---|---|
| [T15](tasks/T15-cameras.md) | Camera polling + views + E2E | ✅ | T09,T08 | opus/high | f286715 |
| [T16](tasks/T16-audio-protocol.md) | Research calaos_server audio protocol → spec + mock | ✅ | T04 | fable/high | 944298c |
| [T17](tasks/T17-audio-player.md) | Full audio player (store, views, transport, volume) | ✅ | T16,T09 | opus/high + frontend-design | d443109 |

## M4 — Polish (demo: release candidate)

| ID | Task | Status | Deps | Agent | Commit |
|---|---|---|---|---|---|
| [T18](tasks/T18-responsive-a11y.md) | Responsive + a11y + visual polish | ✅ | T14,T17 | opus/high + frontend-design + playwright | bcafa52 |
| [T19](tasks/T19-i18n.md) | i18n completion en+fr | ✅ | T18 | sonnet/medium | a127828 |

## M5 — Cutover

| ID | Task | Status | Deps | Agent | Commit |
|---|---|---|---|---|---|
| [T20](tasks/T20-cutover.md) | Cutover: new app becomes dist/, delete old app, docs | ✅ | T19 | fable/high | aa557bf — NOT PUSHED: awaiting operator smoke test on 192.168.30.17 |
| [T21](tasks/T21-ci.md) | CI test workflow | ✅ | T08 | sonnet/low | 1cd5233 |

Parallelizable: T02∥T04 · T11∥T12∥T13 · T15∥T16 · T21 any time after T08.
Critical path: T01→T02→T03→T05→T06→T07→T08→T09→T10→(T11,T12,T13)→T14→(T17,T18)→T19→T20.


## M6 — Distribution modernization (delivery = CI-built release assets)

| ID | Task | Status | Deps | Agent | Commit |
|---|---|---|---|---|---|
| [T22](tasks/T22-release-pipeline.md) | Release pipeline: release.yml, dist/ leaves git, delete local Docker + dead workflows | ✅ | T20 | opus/medium | c076f03 |
| [T23](tasks/T23-calaos-base-pr.md) | calaos_base PR: consume the release asset (ARG WEBAPP_VERSION) | ❌ | — | — | superseded by T26 |


## M7 — Standalone deb + calaos release convention

| ID | Task | Status | Deps | Agent | Commit/PR |
|---|---|---|---|---|---|
| [T24](tasks/T24-calaos-release-convention.md) | Org-standard release flow: bump action, -dev on push, pkgdebs dispatch | 🟨 | T22 | opus/high | |
| [T25](tasks/T25-pkgdebs-package.md) | pkgdebs PR: calaos-web-app deb + calaos-server Depends + bind-mount | 🟨 | — | opus/high | |
| [T26](tasks/T26-calaos-base-dockerfile.md) | calaos_base PR: Dockerfile release asset + ARG (supersedes T23) | 🟨 | — | sonnet/medium | |

## Milestone smoke tests (manual, real server)

At the end of each milestone: `.env.development.local` → `CALAOS_SERVER=http://192.168.30.17:5454`, run `npm run dev:next`, verify the milestone demo against the real calaos_server. T20 has the full pre-push checklist.
