# T22 — Release pipeline modernization (CI-built artifacts, dist/ leaves git)

**Milestone**: M6 · **Deps**: T20 · **Agent**: opus / medium effort / no skills

## Context
The webapp's only consumer is calaos_base's Dockerfile, which today downloads the git-tag SOURCE archive and extracts the committed `dist/`. We switch to CI-built GitHub Release assets: `dist/` leaves git, a release workflow builds/tests/packages/publishes. The local Docker image and the dead dispatch workflows go away.

## Work
1. Create `.github/workflows/release.yml` — `workflow_dispatch` with `version` input (bare `x.x.x`, matching existing tags): guard `version == package.json.version` (explicit failure otherwise); full gates (npm ci, lint, typecheck, unit, E2E with Playwright browser cache like test.yml); `npm run build`; package the CONTENTS of `dist/` (files at archive root) as `calaos-web-app-<version>.tar.gz`; create tag `<version>` + GitHub Release with the asset (`gh release create <version> <tarball> --generate-notes`).
2. Delete `Dockerfile` and `.github/workflows/{build.yml,build_dev.yml,build_release.yml,docker-publish.yml}`. `test.yml` unchanged.
3. Un-track `dist/`: `git rm -r --cached dist` (stage the deletion; the operator commits) + add `dist/` to `.gitignore`. `vite.config.ts` unchanged.
4. Docs: rewrite the deployment sections of `CLAUDE.md` and `docs/ARCHITECTURE.md` (old invariant "dist/ committed, CI never builds" → "delivery = GitHub Release asset via release.yml; never commit dist/"); README release section; rewrite `.claude/skills/release/SKILL.md` (bump package.json → commit → push → `gh workflow run release.yml -f version=x.y.z` → verify `gh release view <version>` shows the asset; drop the dist-staleness preflight — CI builds now).

## Acceptance criteria
- [ ] `python3 -c yaml.safe_load` parses release.yml; the packaging step replayed locally (build + tar + `tar tzf` shows index.html at root, hashed assets/).
- [ ] `git ls-files dist` empty (staged); `dist/` gitignored; `npm run build && npm run test:e2e` still green with dist/ untracked.
- [ ] `npm run lint`, `typecheck`, `test:unit` green.
- [ ] `grep -ri "committed" docs/ CLAUDE.md README.md` shows no stale claims about committed dist/.
- [ ] Other workflows: only test.yml + release.yml remain.
