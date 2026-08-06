# T11 — Slider/stepper IOs (light_dimmer, analog_out, var_int)

**Milestone**: M2 · **Deps**: T10 · **Agent**: sonnet / medium effort / skills: run

## Goal
The stepper and slider IO types with commit-on-release semantics.

## References
- `docs/ARCHITECTURE.md` — parser table rows light_dimmer / analog_out / var_int.
- Old templates: `src/views/io/{light_dimmer,analog_out,var_int}.html` (old slider committed on `ng-mouseup` — new one must commit on `pointerup`/`change`, once).

## Files
Create: `app/src/components/io/{LightDimmerIo,AnalogOutIo,VarIntIo}.vue`, `app/src/components/ui/BaseSlider.vue` (emits `@commit` exactly once on release, live value display during drag), + specs.

## Acceptance criteria
- [ ] BaseSlider component spec: dragging emits no commit; release emits exactly one `commit` with the final value (works with mouse and touch pointer events).
- [ ] Dimmer: on/off buttons send `'true'`/`'false'`; slider release sends `set N` (0-100); percent label live-updates from state (`'set 50'` → 50%, `'true'` → 100%).
- [ ] analog_out / var_int: `+`/`-` send `'inc'`/`'dec'`; value+unit displayed; `rw === false` hides controls.
- [ ] `npm run test:unit`, `lint`, `typecheck` green; manual check vs mock.
