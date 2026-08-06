# T12 — BaseDialog + color picker + text dialog IOs

**Milestone**: M2 · **Deps**: T10 · **Agent**: opus / medium effort / skills: frontend-design, run

## Goal
The modal primitive and the two dialog-driven IO types: light_rgb (color picker) and var_string/string_out (text input).

## References
- `docs/ARCHITECTURE.md` — parser table rows light_rgb / var_string; "Styling" (color picker `@ckpack/vue-color`, contract `#rrggbb`).
- Old: `src/views/{color-picker,dialog-text}.html`, `src/scripts/controllers/io.js` (LightRGBCtrl/ColorPickerCtrl/VarStringCtrl/StringDialogCtrl — note: text sends RAW, rgb sends `set #rrggbb`), ngDialog options (`closeByDocument:false` → no backdrop close).

## Files
Create: `app/src/components/ui/BaseDialog.vue` (modal, focus trap, Esc closes, NO backdrop close), `app/src/components/dialogs/{ColorPickerDialog,TextInputDialog}.vue` (contracts: `confirm('#rrggbb')` / `confirm(rawText)`), `app/src/components/io/{LightRgbIo,VarStringIo}.vue` (VarStringIo also serves string_out), + specs. Add `@ckpack/vue-color` dep.

## Acceptance criteria
- [ ] BaseDialog spec: backdrop click does NOT close; Esc closes; focus trapped inside; restores focus on close.
- [ ] rgb: swatch reflects current color; on/off send `'true'`/`'false'`; picker confirm sends `set #rrggbb` (lowercase hex, test asserts exact frame).
- [ ] var_string/string_out: shows name when state empty; dialog confirm sends the raw text with NO prefix; Cancel sends nothing.
- [ ] `npm run test:unit`, `lint`, `typecheck` green; manual check vs mock.
