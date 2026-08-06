# T20 — Cutover: the Vue app becomes dist/

**Milestone**: M5 · **Deps**: T19 · **Agent**: fable / high effort / skills: run

## Goal
Single atomic switch: `npm run build` produces the Vue app into `dist/`, the old app is deleted, docs rewritten. NOT PUSHED until the manual smoke test passes.

## References
- `docs/ARCHITECTURE.md` — "Deployment invariants", "Repo layout".

## Files
- `package.json`: `dev`/`build`/`preview` → vite; remove `:next` scripts; DELETE old deps (angular*, @uirouter/angularjs, jquery, ng-dialog, es5-shim, json3, magnific-popup, font-awesome-animation, @fortawesome/fontawesome-free, terser, clean-css, html-minifier-terser); regenerate lockfile.
- `vite.config.ts`: `outDir: '../dist'`, `emptyOutDir: true`.
- Delete `src/` and `tools/`; prune `eslint.config.mjs` old blocks; `.gitignore` cleanup (`src/libs`, `dev_config.js`, `assets.json` entries).
- Rewrite `README.md` (new dev workflow: npm install, `npm run dev` + `npm run mock` or `.env.development.local`, build, test) and `CLAUDE.md` (new stack; keep the invariants: committed dist/, CI never builds, empty-host rule successor, mock server, real-server override).
- Rebuild `dist/` from scratch and stage it.

## Acceptance criteria
- [ ] `rm -rf node_modules package-lock.json && npm install && npm run build` → Vue app in `dist/` with hashed assets; `git ls-files src tools` empty.
- [ ] `npm run lint && npm run typecheck && npm run test:unit && npm run test:e2e` all green.
- [ ] `docker build .` succeeds; container serves the app on :3000 (curl index + one hashed asset).
- [ ] **Manual smoke test against `http://192.168.30.17:5454` — operator sign-off required BEFORE push**: cold load shows login without shake; wrong then right creds; rooms match real config (accents in names OK); toggle a real light and watch the echo; dimmer slider; RGB picker; shutter up/stop/down; scenario; cameras stream; unplug network → banner → replug → auto-recovery without re-login bounce; phone-sized browser; fr + en locales; audio player against the real server (validate T16's "Unverified" items).
- [ ] Rollback story documented in the commit message: `git revert` of this commit restores the old app (dist/ is in history).
