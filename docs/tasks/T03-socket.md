# T03 — CalaosSocket + server-url

**Milestone**: M1 · **Deps**: T02 · **Agent**: opus / medium effort / no skills

## Goal
Framework-free reconnecting WS client and the WS URL derivation.

## References
- `docs/ARCHITECTURE.md` — "WS client".
- Old behavior to match: `src/scripts/reconnecting-websocket.js` defaults (reconnectInterval 1000, decay 1.5, max 30000, timeoutInterval 2000, infinite retry) and `src/scripts/services.js:216-227` (URL derivation — including the empty-port bug to FIX).

## Files
Create: `app/src/protocol/socket.ts` (CalaosSocket class, injectable WebSocket ctor, typed emitter `open`/`close`/`message`/`statuschange`, NO auth logic), `app/src/protocol/server-url.ts` (`wsUrl(loc = location)` using `location.host`), + specs.

## Acceptance criteria
- [ ] Fake-timer tests: backoff sequence 1000→1500→2250→… capped at 30000; 2 s connect timeout forces close+retry; infinite retry; message events decoded via `decodeServerMessage`.
- [ ] `wsUrl({protocol:'http:',host:'calaos.local'}) === 'ws://calaos.local/api'` (empty-port regression) and `wsUrl({protocol:'https:',host:'x:5454'}) === 'wss://x:5454/api'`.
- [ ] `npm run test:unit`, `lint`, `typecheck` green.
