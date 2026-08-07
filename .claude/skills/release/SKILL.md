---
name: release
description: Cut a calaos-web-app release — bump the version in package.json, commit to master, and trigger release.yml, which runs the gates, builds, tags and publishes the calaos-web-app-<version>.tar.gz Release asset. Usage: /release 3.0.1
disable-model-invocation: true
---

Cut a release of calaos-web-app. Requested version: $ARGUMENTS

1. Validate the version: bare `x.x.x` (no `v` prefix, no suffix — tags are bare versions). If no version was given, ask for one.
2. Preflight checks — abort and report if any fail:
   - On branch `master` with a clean working tree (`git status`).
   - Local master is up to date with `origin/master` (`git fetch origin && git status`).
   - The tag does not already exist (`git tag -l x.x.x` and `gh release view x.x.x` must both come up empty).
   (No `dist/` staleness check: `dist/` is gitignored and the workflow builds it.)
3. Set `"version"` in `package.json` to the new version, commit with message `bump version to x.x.x` (short, lowercase, matching repo style), and push to master.
4. Trigger the workflow: `gh workflow run release.yml -f version=x.x.x`.
   It re-validates that the version matches `package.json`, re-runs lint/typecheck/unit/E2E, builds, and creates the tag itself via `gh release create` — NEVER create the tag manually.
5. Watch it: `gh run watch` (or `gh run list --workflow=release.yml --limit 1` for the run URL). Report the URL.
6. Verify the result: `gh release view x.x.x` must list the asset `calaos-web-app-x.x.x.tar.gz`. Report the release URL. If the run failed, report which step failed — the version guard fails fast when `package.json` was not bumped/pushed, and the Playwright report is uploaded as an artifact on E2E failure.
