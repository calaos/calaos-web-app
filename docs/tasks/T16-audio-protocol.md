# T16 — Research calaos_server audio protocol → spec + mock extension

**Milestone**: M3 · **Deps**: T04 · **Agent**: fable / high effort / no skills (uses gh + WebFetch)

## Goal
The old audio player is a stub with NO protocol behind it. Before implementing the real player (T17), produce an authoritative spec of the calaos_server audio API from its source, and extend the mock server to speak it. No guessing: everything in the spec must cite the calaos_server source file it comes from.

## References
- Upstream repo: `github.com/calaos/calaos_base` (calaos_server sources; look at the JSON/WS API layer, e.g. `src/bin/calaos_server/Json*` / `Audio*` files, and any protocol docs). Use `gh api`/`gh search code`/WebFetch.
- What the old app already knows: `audio` array in get_home (`{id, name, status, volume?, position?, current_track:{artist,album,title,duration}}`), unimplemented events named in old `src/scripts/services.js` TODO: `audio_volume`, `audio_status`, `audio songchanged`; intended commands from the old stub template: `play`, `pause`?, `stop`, `next`, `prev`, volume set, position seek, cover art URL.

## Files
Create: `docs/audio-protocol.md` (message shapes for commands + events + cover art, with source citations, and a "confidence" note per item). Extend: `mock-server/state.js`/`index.js` + `fixtures/home.json` (audio commands, status/volume/songchanged event emission, a small cover image), `mock-server.test.js` (audio cases).

## Acceptance criteria
- [ ] `docs/audio-protocol.md` covers: player state model, transport commands (exact JSON), volume get/set, position/seek if supported, track metadata + cover art retrieval, and the three audio events — each with a calaos_base source citation (file path + symbol).
- [ ] Anything that could NOT be confirmed from source is listed explicitly under "Unverified" with the proposed fallback (to validate against the real server at 192.168.30.17 during T17).
- [ ] Mock server implements the spec'd commands/events; `mock-server.test.js` green with the new audio cases.
- [ ] `npm run lint` + `typecheck` green.
