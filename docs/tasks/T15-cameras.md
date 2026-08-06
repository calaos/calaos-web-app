# T15 — Camera polling + views + E2E

**Milestone**: M3 · **Deps**: T09, T08 · **Agent**: opus / high effort / skills: run

## Goal
Camera list and single-camera views with sane `<img>` polling (no canvas, no 10 ms hammering), error handling, and credential isolation.

## References
- `docs/ARCHITECTURE.md` — "Camera polling" (250 ms interval, backoff, visibility pause, placeholder) and URL shape.
- Old: `src/scripts/camera-directive.js` (behavior being replaced), `src/scripts/services.js:143-167` (URL construction), `src/views/{cameralist,camera}.html`.

## Files
Create: `app/src/composables/useCameraPoll.ts`, `app/src/services/camera-url.ts` (the ONLY module that touches `cn_user`/`cn_pass` in URLs — relative `/api?...` so dev proxy covers it), `app/src/views/{CameraListView,CameraView}.vue`, `e2e/cameras.spec.ts`, + specs.

## Acceptance criteria
- [ ] Poll spec (fake timers): next frame scheduled 250 ms after load; error → backoff 1→10 s; 3 consecutive errors → `error:true`; pause on `document.hidden`; stop on unmount.
- [ ] E2E: camera list renders mock snapshots and the request counter grows; single-camera view larger; camera endpoint killed via mock → placeholder appears, recovery works; navigating away stops polling.
- [ ] `grep -rl cn_pass app/src` lists at most `services/camera-url.ts` and its spec.
- [ ] `npm run test:unit`, `test:e2e`, `lint`, `typecheck` green.
