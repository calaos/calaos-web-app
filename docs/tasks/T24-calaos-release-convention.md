# T24 — Adopt the calaos org release convention (bump action, dev prereleases, pkgdebs dispatch)

**Milestone**: M7 · **Deps**: T22 · **Agent**: opus / high effort

## Goal
Replace T22's hand-rolled release.yml with the org-standard consolidated flow (model: calaos-container's build-deb-push.yml): git tags as the single version source, `-dev.N` prerelease on every master push, manual major/minor/patch dispatch, release asset + repository_dispatch to pkgdebs.

## Work
1. `test.yml`: triggers become `pull_request` + `workflow_call` (REMOVE `push` — release.yml's `needs: ci` covers pushes; keeping push would run the suite twice).
2. Rewrite `release.yml`: `on: push: branches:[master]` + `workflow_dispatch(vincrement: choice[major,minor,patch], default patch)`; job `ci: uses: ./.github/workflows/test.yml`; then: `calaos/action-bump-version@2` with `version_fragment: ${{ github.event.inputs.vincrement || 'prerelease' }}` → npm ci → `npm version --no-git-tag-version $VERSION` → build → deterministic tar of dist/ contents as `calaos-web-app-$VERSION.tar.gz` → tag via `negz/create-tag@v1` (secrets.ACTION_DISPATCH) → release via `meeDamian/github-release@2.0` (asset, `prerelease: ${{ github.event.inputs.vincrement == '' }}`, token ACTION_DISPATCH) → `peter-evans/repository-dispatch@v1` to `calaos/pkgdebs`, `event-type: build_deb`, payload `{"pkgname":"calaos-web-app","version":$V,"image_src":"","prerelease":<same expr>}`. Release MUST be created before the dispatch (the deb build curls the asset).
3. `package.json`: version becomes the placeholder `0.0.0-git` (never hand-bumped again; CI injects).
4. `.claude/skills/release/SKILL.md` rewritten: `/release [major|minor|patch]` → preflight (clean tree, up-to-date master) → `gh workflow run release.yml -f vincrement=…` → watch → `gh release view` shows the asset. Note: every master push already cuts a `-dev.N` prerelease automatically.
5. Docs: ARCHITECTURE.md deployment section + CLAUDE.md + README release section (tags = version truth, prerelease-on-push, deb delivery chain via pkgdebs, apt repo deb.calaos.fr).

## Acceptance criteria
- [ ] yaml.safe_load on both workflows; expressions verified against the calaos-container reference semantics.
- [ ] Packaging step replayed locally (same tar flags as T22, index.html at root).
- [ ] Bump behavior simulated against this repo's real tags (reimplement get-last-version+bump.py logic in a scratch script): max tag 3.0.1 → prerelease=3.0.2-dev.0, patch=3.0.2, minor=3.1.0, major=4.0.0.
- [ ] `npm run lint`, `typecheck`, `test:unit`, `build` green with the placeholder version.
- [ ] No stale docs claims (grep release/version across docs).
