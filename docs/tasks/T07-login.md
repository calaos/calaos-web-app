# T07 — Login screen + flow

**Milestone**: M1 · **Deps**: T06 · **Agent**: opus / medium effort / skills: frontend-design, run

## Goal
The login view: Calaos-identity welcome screen, failure shake, ≥400 ms success spinner, and the Enter-submits fix (old form never submitted on Enter).

## References
- `docs/ARCHITECTURE.md` — "Stores" (auth machine), "Styling".
- Old view: `src/views/login.html` + `.container`/`form` styles in `src/styles/main.css` (Welcome heading, form-success transition, shake, offline warning with pulsing icon).

## Files
Create: `app/src/views/LoginView.vue`. Extend `app/src/i18n/en.json` (login strings). Wire as the `/login` route.

## Acceptance criteria
- [ ] dev+mock: wrong creds → button shake + inline error message, stays on login; correct creds (demo/demo) → spinner ≥400 ms → `/#/home` (route exists as placeholder until T09 — landing on it must not error).
- [ ] Enter in either field submits the form.
- [ ] Cold page load sends ZERO login frames before the user submits (verify via mock `POST /control {op:'log'}`).
- [ ] Sign-out from the navbar returns to login with cleared fields; offline state shows the no-connection warning instead of silently ignoring submit.
- [ ] `npm run test:unit`, `lint`, `typecheck` green.
