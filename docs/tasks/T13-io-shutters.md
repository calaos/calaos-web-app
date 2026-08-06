# T13 — Shutter IOs (shutter, shutter_smart)

**Milestone**: M2 · **Deps**: T10 · **Agent**: sonnet / medium effort / skills: run

## Goal
The two shutter types with up/stop/down controls and the smart-shutter position display.

## References
- `docs/ARCHITECTURE.md` — parser table rows shutter / shutter_smart (numeric percent compare fixes the old `v < 100` string-vs-number bug).
- Old: `src/views/io/shutter.html` (shared by both types), `src/scripts/controllers/io.js` ShutterCtrl.

## Files
Create: `app/src/components/io/{ShutterIo,ShutterSmartIo}.vue` + specs.

## Acceptance criteria
- [ ] Buttons send exactly `'up'` / `'stop'` / `'down'`.
- [ ] shutter: open indicator ⇔ `state === 'true'`. shutter_smart: shows position % parsed from `'up|down|stop <pct>'`, open indicator ⇔ percent < 100 numerically, NaN → 0 (spec covers `'stop 30'`, `'up 100'`, `'down'` without number).
- [ ] `rw === false` hides buttons; state icon crossfades.
- [ ] `npm run test:unit`, `lint`, `typecheck` green; manual check vs mock.
