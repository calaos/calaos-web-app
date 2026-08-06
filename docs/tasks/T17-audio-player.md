# T17 — Full audio player

**Milestone**: M3 · **Deps**: T16, T09 · **Agent**: opus / high effort / skills: frontend-design, run

## Goal
The real audio feature the old app never had: player list with covers and metadata, and a working player view (transport, volume, position, live events) against the T16 protocol spec.

## References
- `docs/audio-protocol.md` (T16 output — authoritative).
- Old intent: `src/views/{audiolist,audio_player}.html` (layout intent: cover assembly, transport row, metadata labels — all dead code today, reimagine with the light-refresh design language).

## Files
Create: `app/src/views/{AudioListView,AudioPlayerView}.vue`, audio state in `app/src/stores/home.ts` (or a dedicated `audio.ts` store if cleaner), event handling entries (`audio_status`/`audio_volume`/`audio songchanged`) in the dispatch table, protocol additions in `app/src/protocol/` per spec, + specs.

## Acceptance criteria
- [ ] Audio list: one card per player (name, current track, cover with graceful fallback when absent), navigates to `/#/audio/:playerId`.
- [ ] Player view vs mock: play/pause/stop/next/prev send the spec'd frames (assert via `/control log`); volume slider commits on release; metadata and status update live when the mock emits audio events; position display if the protocol supports it.
- [ ] Unit specs for the audio store/event handling; E2E happy-path spec (list → player → play → status change reflected).
- [ ] Items from the spec's "Unverified" list are behind graceful degradation (feature hidden or tolerant parsing), and flagged in the task report for the milestone smoke test on `192.168.30.17`.
- [ ] `npm run test:unit`, `test:e2e`, `lint`, `typecheck` green.
