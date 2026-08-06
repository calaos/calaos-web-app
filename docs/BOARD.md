# Vue 3 Rewrite — Task Board

Source of truth for the rewrite progress. One row per task; details in [`tasks/`](tasks/). Status: ⬜ todo · 🟨 in progress · ✅ done (with commit hash) · ⛔ blocked.

Execution: each task runs in a dedicated subagent (model/effort/skills per its task file), is verified against its acceptance criteria, then committed (one commit per task) and marked ✅ here. Architecture reference: [ARCHITECTURE.md](ARCHITECTURE.md).

## M1 — Scaffold + login (demo: log into mock server)

| ID | Task | Status | Deps | Agent | Commit |
|---|---|---|---|---|---|
| [T01](tasks/T01-scaffold.md) | Scaffold Vite/TS/Vitest/ESLint + styled hello | ✅ | — | sonnet/medium | 4b25caa |
| [T02](tasks/T02-protocol.md) | Protocol types, guards, codecs, IO state parsers | ✅ | T01 | fable/high | 9481f10 |
| [T03](tasks/T03-socket.md) | CalaosSocket + wsUrl | ✅ | T02 | opus/medium | d60f7a2 |
| [T04](tasks/T04-mock-server.md) | Mock calaos_server + /control + fixtures | ✅ | T01 | opus/medium | 01da3d3 |
| [T05](tasks/T05-stores.md) | Pinia stores + calaos service wiring | 🟨 | T02,T03 | opus/high | |
| [T06](tasks/T06-shell.md) | App shell, router, chrome | ⬜ | T05 | opus/medium + frontend-design | |
| [T07](tasks/T07-login.md) | Login screen + flow | ⬜ | T06 | opus/medium + frontend-design | |
| [T08](tasks/T08-e2e-infra.md) | Playwright infra + M1 E2E | ⬜ | T04,T07 | opus/medium | |

## M2 — Home, rooms, all IOs (demo: full control of mock home)

| ID | Task | Status | Deps | Agent | Commit |
|---|---|---|---|---|---|
| [T09](tasks/T09-home-room.md) | Home grid + Room view shell | ⬜ | T06 | opus/medium + frontend-design | |
| [T10](tasks/T10-io-simple.md) | IoRow dispatcher + simple IOs + StateIcon | ⬜ | T09,T02 | opus/high + frontend-design | |
| [T11](tasks/T11-io-sliders.md) | Slider/stepper IOs (dimmer, analog_out, var_int) | ⬜ | T10 | sonnet/medium | |
| [T12](tasks/T12-io-dialogs.md) | BaseDialog + color picker + text dialog IOs | ⬜ | T10 | opus/medium + frontend-design | |
| [T13](tasks/T13-io-shutters.md) | Shutter IOs (shutter, shutter_smart) | ⬜ | T10 | sonnet/medium | |
| [T14](tasks/T14-e2e-io.md) | E2E IO interaction suite | ⬜ | T08,T11,T12,T13 | opus/medium | |

## M3 — Cameras + audio (demo: full feature surface)

| ID | Task | Status | Deps | Agent | Commit |
|---|---|---|---|---|---|
| [T15](tasks/T15-cameras.md) | Camera polling + views + E2E | ⬜ | T09,T08 | opus/high | |
| [T16](tasks/T16-audio-protocol.md) | Research calaos_server audio protocol → spec + mock | ⬜ | T04 | fable/high | |
| [T17](tasks/T17-audio-player.md) | Full audio player (store, views, transport, volume) | ⬜ | T16,T09 | opus/high + frontend-design | |

## M4 — Polish (demo: release candidate)

| ID | Task | Status | Deps | Agent | Commit |
|---|---|---|---|---|---|
| [T18](tasks/T18-responsive-a11y.md) | Responsive + a11y + visual polish | ⬜ | T14,T17 | opus/high + frontend-design + playwright | |
| [T19](tasks/T19-i18n.md) | i18n completion en+fr | ⬜ | T18 | sonnet/medium | |

## M5 — Cutover

| ID | Task | Status | Deps | Agent | Commit |
|---|---|---|---|---|---|
| [T20](tasks/T20-cutover.md) | Cutover: new app becomes dist/, delete old app, docs | ⬜ | T19 | fable/high | |
| [T21](tasks/T21-ci.md) | CI test workflow | ⬜ | T08 | sonnet/low | |

Parallelizable: T02∥T04 · T11∥T12∥T13 · T15∥T16 · T21 any time after T08.
Critical path: T01→T02→T03→T05→T06→T07→T08→T09→T10→(T11,T12,T13)→T14→(T17,T18)→T19→T20.

## Milestone smoke tests (manual, real server)

At the end of each milestone: `.env.development.local` → `CALAOS_SERVER=http://192.168.30.17:5454`, run `npm run dev:next`, verify the milestone demo against the real calaos_server. T20 has the full pre-push checklist.
