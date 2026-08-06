---
name: release
description: Cut a calaos-web-app release — bump the version in package.json, commit to master, and trigger the GitHub release workflow (which creates the tag itself). Usage: /release 3.0.1 (or /release 3.0.1-dev for a dev build).
disable-model-invocation: true
---

Cut a release of calaos-web-app. Requested version: $ARGUMENTS

1. Validate the version: `x.x.x` for a release, `x.x.x-dev` for a dev build. If no version was given, ask for one.
2. Preflight checks — abort and report if any fail:
   - On branch `master` with a clean working tree (`git status`).
   - Local master is up to date with `origin/master` (`git fetch origin && git status`).
   - Warn if `src/` has commits newer than the last commit touching `dist/` (`git log -1 --format=%ci -- src/` vs `git log -1 --format=%ci -- dist/`): the Docker image and packages ship the committed `dist/`, so a stale `dist/` means the release won't contain the latest source changes. Ask the user whether to continue.
3. For a plain `x.x.x` release: set `"version"` in `package.json` to the new version, commit with message `bump version to x.x.x` (short, lowercase, matching repo style), and push to master. For an `x.x.x-dev` build: skip the version bump.
4. Trigger the workflow:
   - Release: `gh workflow run build_release.yml -f version=x.x.x`
   - Dev build: `gh workflow run build_dev.yml -f version=x.x.x-dev`
   The workflow dispatches the package build to calaos/calaos-build and creates the git tag itself — NEVER create the tag manually.
5. Confirm it started: `gh run list --workflow=build_release.yml --limit 1` (or `build_dev.yml`), and report the run URL.
