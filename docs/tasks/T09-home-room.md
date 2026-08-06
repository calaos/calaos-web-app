# T09 — Home grid + Room view shell

**Milestone**: M2 · **Deps**: T06 · **Agent**: opus / medium effort / skills: frontend-design, run

## Goal
The Home room grid (CSS Grid, replaces JS 3-per-row chunking) and the Room detail shell that T10+ fill with IO rows.

## References
- `docs/ARCHITECTURE.md` — "Styling" (grid spec), "Stores" (rooms/roomId semantics).
- Old views: `src/views/home.html` (room card: icon, name, temp badge), `src/views/room.html` (layout), `src/scripts/utils.js` (room type → icon mapping to port into `RoomIcon.vue` as MDI icons — fix the implicit-global fallback bug: unknown type → default home icon).

## Files
Create: `app/src/views/{HomeView,RoomView}.vue`, `app/src/components/ui/RoomIcon.vue` (complete type map: salon/lounge, chambre/bedroom, cuisine/kitchen, bureau/office, sam/diningroom, cave/cellar, divers/various/misc, exterieur/outside, sdb/bathroom, hall/couloir/corridor, garage, Internal, default), `e2e/home-rooms.spec.ts`.

## Acceptance criteria
- [ ] Room cards render in a responsive CSS grid (`auto-fill, minmax(9.5rem,1fr)`), sorted by `hits` desc, each with MDI room icon, name, and a temperature badge when the room has a temp IO.
- [ ] Card click → `/#/home/:roomId`; RoomView shows room name/icon and an (empty until T10) IO list; back button appears and works.
- [ ] Invalid roomId (`/#/home/99`) redirects to `/#/home`.
- [ ] E2E home-rooms spec green incl. mobile viewport ≥2 columns without horizontal scroll.
- [ ] `npm run test:unit`, `test:e2e`, `lint`, `typecheck` green.
