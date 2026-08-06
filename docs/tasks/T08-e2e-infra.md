# T08 — Playwright infra + M1 E2E

**Milestone**: M1 · **Deps**: T04, T07 · **Agent**: opus / medium effort / no skills

## Goal
Playwright wired against the BUILT app + mock server, plus the M1 spec suite.

## References
- `docs/ARCHITECTURE.md` — "Testing strategy".

## Files
Create: `playwright.config.ts` (`webServer: [{command:'node mock-server/index.js', port:5454}, {command:'vite build && vite preview --port 4173', port:4173}]`, chromium + mobile-viewport projects; preview proxy must forward `/api` ws+http to the mock), `e2e/fixtures.ts` (`mockControl` helper for `/control`), `e2e/login.spec.ts`, `e2e/reconnect.spec.ts`. Add `npm run test:e2e` + `@playwright/test` devDep.

## Acceptance criteria
- [ ] `npm run test:e2e` green: login success lands on `/#/home`; login failure shows shake/error and stays; cold load produces zero login frames in `/control log`; `{op:'drop'}` → banner appears → auto-reconnect → auto-re-login → banner gone and session survives (no bounce to /login).
- [ ] Suite passes on both projects (desktop + mobile viewport).
- [ ] `npm run lint` + `typecheck` green.
