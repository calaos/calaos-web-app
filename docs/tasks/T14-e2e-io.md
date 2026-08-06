# T14 — E2E IO interaction suite

**Milestone**: M2 · **Deps**: T08, T11, T12, T13 · **Agent**: opus / medium effort / no skills

## Goal
End-to-end proof that every interactive IO type sends the exact wire frames and that the UI updates only on the server's `io_changed` echo.

## References
- `docs/ARCHITECTURE.md` — "Testing strategy"; mock `/control log` returns every received frame.

## Files
Create: `e2e/io-interactions.spec.ts`.

## Acceptance criteria
- [ ] `npm run test:e2e` green with roundtrip specs: light toggle (frame `{msg:'set_state',data:{id,value:'true'}}` in mock log, icon flips only after broadcast), dimmer slider drag+release (exactly ONE `set N` frame), rgb dialog confirm (`set #rrggbb`), var_int inc/dec, scenario play, shutter up/stop/down.
- [ ] Pending indicator visible between action and echo (use `/control latency` to widen the window).
- [ ] External `push_io` updates the room view live without user interaction.
- [ ] `visible:"false"` fixture IO absent; `rw:"false"` fixture IO shows no controls.
- [ ] `lint` + `typecheck` green.
