# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Legacy AngularJS 1.8 web frontend for the Calaos home automation server. Plain ES5, no modules, no bundler — scripts are loaded as `<script>` tags in `src/index.html` and concatenated at build time into the bundles named by the `<!-- build:* -->` blocks.

## Build toolchain (npm-only, Node >= 18)

- `npm install`, then `npm run build` (regenerates `dist/`), `npm run dev` (serves `src/` on port 8000). No gulp, no bower.
- The build lives in `tools/` (`build.js`, `serve.js`, `common.js`): plain Node scripts using terser, clean-css and html-minifier-terser. It parses the usemin-style build blocks in `src/index.html`.
- Runtime libraries (angular, jquery, ngDialog, Font Awesome…) come from npm and are synced into `src/libs/` (gitignored) by the tools; `src/vendor/` holds third-party code with no npm package (angular-farbtastic).
- The app bundle (`build:js`) is minified WITHOUT name mangling: AngularJS DI reads function parameter names and not all app code uses explicit `['dep', function(dep)]` annotations. Don't "optimize" this.
- CSS is minified without URL rebasing on purpose: `url(../webfonts|../fonts|../images)` resolve because of the `dist/` layout. Don't enable rebasing.

## dist/ is committed and is the sole input to the Docker image

- CI never runs a build. `docker-publish.yml` copies the committed `dist/` straight into `ghcr.io/calaos/calaos-web-app`, and the calaos/pkgbuilds PKGBUILD packages the committed `dist/` too. A `src/` change without `npm run build` + committing `dist/` ships stale code.
- Never hand-edit files under `dist/`; they are build outputs (`dist/scripts/dev_config.js` in particular is generated with an empty host on purpose — the app derives the WebSocket URL from `window.location` when the host is empty; never ship a non-empty host).

## Gotchas

- Adding a JS file requires two edits: create it under `src/scripts/` AND add a `<script>` tag inside the `<!-- build:js -->` block in `src/index.html`, or it silently never loads. Same for CSS in the `<!-- build:css -->` block.
- `src/scripts/dev_config.js` is gitignored; set `calaosServerHost` (e.g. `ws://192.168.1.10:5454/api`) to develop against a remote calaos_server. In production the WebSocket URL is derived from `window.location` + `/api` — the app assumes it is served by calaos_server itself (port 5454 is the server default).
- Camera images are fetched over HTTP and gated by the SCE whitelist in `src/scripts/app.js`, which hardcodes `http://127.0.0.1:5454/**` — pointing `dev_config.js` at another host blocks camera images until that whitelist is extended.
- `scripts/assets.json` (image-preload manifest) is generated and gitignored; the preloader breaks without it.
- WebSocket protocol: JSON messages with a `msg` field (`login`, `get_home`, `set_state`, `event`). Only the `io_changed` event is handled — see the TODO in `src/scripts/services.js` for the unimplemented ones. The authoritative protocol spec lives in the calaos_server repo.
- `src/scripts/reconnecting-websocket.js` is vendored third-party code — do not edit it.

## Style & lint

- Existing code: mostly ES5, 4-space indent, single quotes, snake_case identifiers are fine. Match the file you're editing.
- No formatter is configured; do not introduce one or mass-reformat existing files.
- Lint with `npm run lint` (ESLint flat config in `eslint.config.mjs`; there is no module system, so cross-file globals are declared there). The codebase has known pre-existing lint errors (35 in `src/scripts/`) — don't add new ones.

## Git & releases

- Commit directly to `master` — no PRs. Pushing to master dispatches a package build to calaos/calaos-build and publishes the Docker image.
- The version lives in `package.json` (bower.json is gone).
- Releases are cut with `gh workflow run build_release.yml -f version=x.x.x` (dev builds: `build_dev.yml` with `x.x.x-dev`). The workflow creates the git tag itself — never create release tags manually. Use the `/release` skill.
