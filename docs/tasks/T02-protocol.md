# T02 — Protocol types, guards, codecs, IO state parsers

**Milestone**: M1 · **Deps**: T01 · **Agent**: fable / high effort / no skills

## Goal
The framework-free protocol layer: TypeScript wire types (discriminated union on the 14 `gui_type`s), defensive runtime guards, message codecs, and the pure per-type IO state parsers — a FAITHFUL transcription of the old AngularJS logic. This is the fidelity-critical core of the rewrite.

## References
- `docs/ARCHITECTURE.md` — "Protocol layer" (incl. the full parser table).
- Old code (authoritative, read carefully): `src/scripts/controllers/io.js` (all parsing precedences), `src/scripts/services.js` (message shapes, `'true'` string comparisons), `src/views/io/*.html` (exact set_state verbs and rw/visible gating per type).

## Files
Create in `app/src/protocol/`: `types.ts`, `guards.ts` (wire→typed conversion, `visible`/`rw` → boolean at ingest, never throws on malformed frames), `messages.ts` (`encodeLogin`/`encodeGetHome`/`encodeSetState`, `decodeServerMessage`), `io-states.ts` (one pure parse function per gui_type + action-verb constants), plus co-located `*.spec.ts` for each.

## Acceptance criteria
- [ ] `npm run test:unit` green; every row of the ARCHITECTURE parser table has ≥2 table-driven test cases, including edge cases: dimmer `'set 50'`/`'true'`/`'42'`, rgb `'0'`/`'#000000'`, shutter_smart `'up 100'`/`'stop 30'`/NaN→0 with NUMERIC percent compare, var_string empty→name fallback.
- [ ] Codec tests assert exact wire JSON (string values everywhere, `set ` prefix rules, raw-text no-prefix for string IOs).
- [ ] `decodeServerMessage` on malformed/unknown frames returns typed fallback, never throws (test with garbage inputs).
- [ ] No Vue import anywhere under `app/src/protocol/` (`grep -r "from 'vue'" app/src/protocol/` empty).
- [ ] `npm run lint` + `npm run typecheck` green.
