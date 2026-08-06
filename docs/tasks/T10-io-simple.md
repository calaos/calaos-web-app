# T10 — IoRow dispatcher + simple IOs + StateIcon

**Milestone**: M2 · **Deps**: T09, T02 · **Agent**: opus / high effort / skills: frontend-design, run

## Goal
The IO row framework (dispatcher + shared frame) and the simple IO types: temp, analog_in, string_in, light, var_bool, scenario, unknown fallback.

## References
- `docs/ARCHITECTURE.md` — "IO state parsers" table (display + verbs per type), "Stores" (useIo, pending).
- Old templates: `src/views/io/{temp,analog_in,string_input,light,var_bool,scenario,default_template}.html`, sprite crossfade CSS in `src/styles/main.css` (label.checkbox pattern — reproduce the feel with stacked SVGs).

## Files
Create: `app/src/components/io/{IoRow,IoRowFrame,TempIo,AnalogInIo,StringInIo,LightIo,VarBoolIo,ScenarioIo,UnknownIo}.vue`, `app/src/components/ui/StateIcon.vue` (two stacked MDI SVGs, opacity crossfade ~.5s), + component specs. Wire the IO list into `RoomView.vue`.

## Acceptance criteria
- [ ] Component spec: IoRow dispatches all 14 gui_types + unknown to the right component (T11-T13 types may resolve to a placeholder that at least shows name/state until their tasks land).
- [ ] `visible === false` IOs absent from DOM; `rw === false` renders NO action buttons (uniformly — including types the old app forgot).
- [ ] light on/off buttons send `'true'`/`'false'`; var_bool same; scenario play sends `'true'`; state icons crossfade on change; a pending dot shows after an action until `io_changed` arrives (visible against the mock).
- [ ] temp shows `state + (unit || '°C')`; analog_in icon honors `gui_style` fallback `default`; string_in shows name when state is empty.
- [ ] `npm run test:unit`, `lint`, `typecheck` green; manual check vs mock via `npm run dev:next`.
