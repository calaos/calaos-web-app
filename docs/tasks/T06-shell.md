# T06 — App shell, router, chrome

**Milestone**: M1 · **Deps**: T05 · **Agent**: opus / medium effort / skills: frontend-design, run

## Goal
Router with auth guard, and the app chrome: background fade-in, NavBar (logo, contextual back button, sign-out `mdi:logout`), FooterNav (3 tabs with a REAL active glow — the old one never worked), connection banner.

## References
- `docs/ARCHITECTURE.md` — "Router", "Styling".
- Old chrome: `src/index.html` (navbar/footer structure), `src/styles/main.css` (navbar gradient, footer, animations). Old bugs to fix here: `$state`-never-on-scope glow, `fa-sign-out` invalid icon.

## Files
Create: `app/src/router/index.ts` (hash history, routes + `requiresAuth` + `detail` meta, guard incl. out-of-bounds param redirect), `app/src/components/chrome/{AppBackground,NavBar,FooterNav,ConnectionBanner}.vue`, `app/src/components/ui/IconButton.vue` (pressable, required aria-label), fill `app/src/styles/animations.css` (fadeIn/fadeInDown/fadeInUp/shake, press feedback, reduced-motion guards). Update `App.vue`.

## Acceptance criteria
- [ ] With `npm run dev:next` + `npm run mock`: unauthenticated hash routes (`/#/home`, `/#/security/0`) redirect to `/#/login`.
- [ ] Background image fades in on load; navbar/footer slide in only once authenticated.
- [ ] Footer tabs navigate; the ACTIVE tab is visually highlighted (CSS, not images) and follows route changes.
- [ ] Kill the mock → connection banner appears ≤2 s (debounced); restart → disappears; no navigation/sign-out is triggered by the disconnect.
- [ ] All tappables have press feedback and aria-labels; `prefers-reduced-motion` disables animations.
- [ ] `npm run test:unit`, `lint`, `typecheck` green.
