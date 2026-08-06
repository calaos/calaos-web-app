# T18 — Responsive + a11y + visual polish

**Milestone**: M4 · **Deps**: T14, T17 · **Agent**: opus / high effort / skills: frontend-design, playwright plugin (browser screenshots)

## Goal
Make the whole surface work from phone to wall tablet (the old app had ZERO media queries), pass a basic a11y bar, and do a final visual coherence pass.

## References
- `docs/ARCHITECTURE.md` — "Styling" (breakpoints ~480/768/1100).
- Old a11y debt NOT to reproduce: `:focus{outline:none}`, no alt/aria anywhere, disabled checkboxes as indicators.

## Files
Touch-ups across `app/src/styles/*`, chrome, views, IO components. `e2e/` screenshot helpers if useful.

## Acceptance criteria
- [ ] 360 / 768 / 1280 px: no horizontal scroll, no overflow, usable tap targets (≥44 px) on every view (login, home, room, cameras, audio) — verified with browser screenshots at each width (playwright plugin), attached to the task report.
- [ ] Every interactive element has an accessible name (aria-label or text); images have alt; `:focus-visible` styles present; dialogs announce (role=dialog, aria-modal).
- [ ] `prefers-reduced-motion` disables shake/crossfade/press/fade animations.
- [ ] Lighthouse (or axe) accessibility score ≥ 90 on `/#/home` — actual score noted in the report.
- [ ] `npm run test:unit`, `test:e2e` (both viewports), `lint`, `typecheck` green.
