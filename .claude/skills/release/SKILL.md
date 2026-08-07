---
name: release
description: Cut a calaos-web-app release — dispatch release.yml with a major/minor/patch increment. The workflow bumps from the highest git tag, runs the gates, builds, tags, publishes the calaos-web-app-<version>.tar.gz Release asset and dispatches the deb build to calaos/pkgdebs. Usage: /release patch
disable-model-invocation: true
---

Cut a release of calaos-web-app. Requested increment: $ARGUMENTS

**Before anything: you almost certainly do not need this skill.** Every push to
`master` already cuts a `-dev.N` prerelease automatically (release.yml's `push`
trigger → `prerelease` fragment). This skill is only for promoting to a real,
non-prerelease version.

The version is **not** in `package.json` — it lives in git tags. `package.json`
holds the literal placeholder `0.0.0-git` and must never be hand-bumped; CI
injects the computed version with `npm version --no-git-tag-version`. Never
create a release tag by hand either — `negz/create-tag@v1` in the workflow owns
that.

1. Resolve the increment from `$ARGUMENTS`: one of `major`, `minor`, `patch`.
   Default to `patch` if nothing was given. Anything else (a bare version like
   `3.0.2`, a `v` prefix, `prerelease`) is invalid — explain that the workflow
   computes the version itself and ask which increment they want.
2. Preflight — abort and report if any fail:
   - On branch `master` with a clean working tree (`git status`).
   - Local master is in sync with `origin/master` (`git fetch origin && git status`)
     — the workflow releases whatever is on `origin/master`, so unpushed commits
     would silently be left out.
   - Show the version that will be produced so the operator can confirm:
     `git fetch --tags` then the highest tag by dpkg ordering (e.g. `3.0.1`)
     bumped by the chosen fragment — `patch` → `3.0.2`, `minor` → `3.1.0`,
     `major` → `4.0.0`.
   (No `dist/` staleness check: `dist/` is gitignored and the workflow builds it.)
3. Trigger the workflow: `gh workflow run release.yml -f vincrement=<fragment>`.
4. Watch it: `gh run watch` (or `gh run list --workflow=release.yml --limit 1`
   for the run URL). Report the URL. The run is `ci` (the full test.yml suite:
   lint, typecheck, unit, E2E) then build → tar → tag → release → dispatch.
5. Verify the result:
   - `gh release view <version>` must exist, be **not** marked as a prerelease,
     and list the asset `calaos-web-app-<version>.tar.gz`. Report the release URL.
   - The last step dispatches `build_deb` to `calaos/pkgdebs`, which builds the
     `.deb` from that asset and pushes it to `deb.calaos.fr/calaos`. It is a
     separate run in another repo — mention it, and point at
     <https://github.com/calaos/pkgdebs/actions> if the operator wants to follow it.
   If the run failed, report which step failed. The Playwright report is uploaded
   as an artifact on E2E failure. A failure in `Create Tag` or `Create a Release`
   usually means `secrets.ACTION_DISPATCH` (the org PAT) is missing or expired —
   `GITHUB_TOKEN` cannot be substituted, it neither re-triggers workflows nor
   reaches `calaos/pkgdebs`.
