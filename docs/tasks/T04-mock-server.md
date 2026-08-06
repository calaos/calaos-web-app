# T04 — Mock calaos_server

**Milestone**: M1 · **Deps**: T01 · **Agent**: opus / medium effort / no skills

## Goal
A small Node mock of calaos_server used for offline dev (`npm run mock`), Playwright E2E, and its own vitest regression tests.

## References
- `docs/ARCHITECTURE.md` — "Mock calaos_server" (full spec: WS protocol, camera endpoint, /control ops) and "Protocol layer" (wire shapes).

## Files
Create `mock-server/`: `index.js` (Node ≥18 ESM, single dep `ws`, one HTTP server, PORT env default 5454), `state.js` (mutable clone of fixtures + set_state transition rules + io_changed broadcast), `control.js` (`push_io`, `drop`, `scenario` [`login_fail_once`|`silent_login`|`reject_all_logins`|`reset`], `latency`, `log`, `reset`), `fixtures/home.json` (ALL 14 gui_types with realistic states, unsorted `hits`, one `visible:"false"` IO, one `rw:"false"` IO, 2 cameras, 1 audio player), `fixtures/camera.png`, `mock-server.test.js` (vitest node env, raw `ws` client). Add `npm run mock` script + `ws` devDep.

## Acceptance criteria
- [ ] `mock-server.test.js` green: login ok (demo/demo) + fail, get_home shape matches wire spec, set_state → io_changed broadcast to a second client, `/control` drop + push_io + log + reset work, camera GET returns image/png with valid creds and 403 without.
- [ ] `npm run mock` starts and logs its port; killable cleanly.
- [ ] `npm run lint` + `typecheck` green (eslint node block for `mock-server/**`).
