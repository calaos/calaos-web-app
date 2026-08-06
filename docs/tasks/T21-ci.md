# T21 — CI test workflow

**Milestone**: M5 (schedulable any time after T08) · **Deps**: T08 · **Agent**: sonnet / low effort / no skills

## Goal
A GitHub Actions workflow running the quality gates on every push/PR — without ever touching `dist/` or the existing publish workflows.

## Files
Create: `.github/workflows/test.yml` — Node 20, npm ci, `lint` + `typecheck` + `test:unit` + `test:e2e` (Playwright browsers cached via `actions/cache` on `~/.cache/ms-playwright`).

## Acceptance criteria
- [ ] Workflow YAML validates (`gh workflow view` after push, or actionlint locally if available); runs on push + pull_request.
- [ ] It never writes to `dist/` and does not modify `docker-publish.yml` / `build*.yml`.
- [ ] E2E step uploads the Playwright report as an artifact on failure.
- [ ] `npm run lint` + `typecheck` green locally.
