# T05 — Pinia stores + calaos service wiring

**Milestone**: M1 · **Deps**: T02, T03 · **Agent**: opus / high effort / no skills

## Goal
State management and the socket↔stores glue, with the deliberate auth fixes.

## References
- `docs/ARCHITECTURE.md` — "Stores (Pinia)".
- Old behavior: `src/scripts/services.js` (get_home processing, io_changed patching, signOut semantics). Bugs NOT to port: empty-credential auto-login, sign-out-on-ws-error, 1.5 s artificial navigation delay, ioCache never cleared on signOut.

## Files
Create: `app/src/stores/{connection,auth,home}.ts`, `app/src/services/calaos.ts` (singleton wiring), `app/src/composables/useIo.ts`, + specs.

## Acceptance criteria
- [ ] Auth machine specs: signIn → pending → authed/failed; NO login frame sent when creds are empty on socket open (regression for the old shake-on-load bug); re-login on reconnect with retained creds; no re-login after explicit rejection.
- [ ] home store specs: get_home normalization (rooms sorted hits desc, `ios` Map identity, per-room `tempIoId`), io_changed patches state/name and clears pending, unknown events hit the dispatch-table stub (console.debug, no throw).
- [ ] pending lifecycle: set → cleared by io_changed; cleared silently after 5 s timeout (fake timers).
- [ ] signOut clears creds + home store (including the ios Map — old bug), socket stays open.
- [ ] `npm run test:unit`, `lint`, `typecheck` green.
