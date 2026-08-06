# T01 — Scaffold Vite app + toolchain

**Milestone**: M1 · **Deps**: — · **Agent**: sonnet / medium effort / no skills

## Goal
Bootstrap the Vue 3 + Vite + TypeScript app in `app/` alongside the untouched old app, with Vitest, ESLint and the transition scripts.

## References
- `docs/ARCHITECTURE.md` — "Repo layout during the rewrite", "File tree", "Styling" (tokens), "Dev server override".

## Files
Create: `vite.config.ts` (root `app`, `/api` proxy incl. `ws:true` driven by `loadEnv` `CALAOS_SERVER` default `http://localhost:5454`, outDir `../dist-next`, production guard against `VITE_CALAOS*`), `vitest.config.ts` (happy-dom, includes `app/**` and `mock-server/*.test.js`), `tsconfig.json` + `tsconfig.app.json` + `tsconfig.node.json`, `app/index.html`, `app/public/favicon.svg`, `app/src/{main.ts,App.vue}`, `app/src/styles/{theme,base,animations}.css` (design tokens per ARCHITECTURE, Ubuntu via `@fontsource/ubuntu`), `app/src/i18n/{index.ts,en.json}` (skeleton).
Modify (additive only): `package.json` (deps: vue, pinia, vue-router, vue-i18n; devDeps: vite, @vitejs/plugin-vue, typescript, vue-tsc, vitest, happy-dom, @vue/test-utils, eslint-plugin-vue, typescript-eslint, unplugin-icons, @iconify-json/mdi, @fontsource/ubuntu; scripts `dev:next`, `build:next`, `preview:next`, `typecheck`, `test:unit`), `eslint.config.mjs` (blocks for `app/**` ts+vue), `.gitignore` (`dist-next/`, `*.local`, `test-results/`, `playwright-report/`).

## Acceptance criteria
- [ ] `npm run dev:next` serves a styled hello page (dark theme tokens visible, Ubuntu font loaded).
- [ ] `npm run build:next` emits `dist-next/` and `dist-next/` is gitignored.
- [ ] `npm run test:unit` runs ≥1 placeholder test green.
- [ ] `npm run lint` and `npm run typecheck` green.
- [ ] Old app untouched: `npm run build && git diff --stat dist/` shows no change; `git status` shows no modification under `src/` or `tools/`.
