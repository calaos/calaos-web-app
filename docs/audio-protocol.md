# Calaos audio protocol — derived from calaos_server sources

Authoritative spec for the T17 audio player, derived by reading the upstream
JSON/WebSocket API implementation. **Source version**: `calaos/calaos_base`,
default branch `master`, HEAD commit `ac5a6b3c730f98b9111004795a7363e928641045`
(2026-08-02). All citations below are paths in that tree; the audio surface of
the get_home payload is byte-identical back to tag `v3.0-rc1`
(`buildJsonAudio` diffed against master), so this is not a recent shape.

Every value on the wire is a **string** (including numbers), as everywhere in
the calaos protocol. Requests may carry a `msg_id`; replies echo it verbatim
(`JsonApiHandlerWS::sendJson`, `src/bin/calaos_server/JsonApiHandlerWS.cpp`).

## Player model

An audio player is an `IOBase` subclass (`AudioPlayer`,
`src/bin/calaos_server/Audio/AudioPlayer.h`) of data type `TSTRING`. Its
constructor (`AudioPlayer.cpp`, `AudioPlayer::AudioPlayer`) forces
`gui_type: "audio_player"` and `visible: "false"`. Concrete backends:
`Squeezebox` (io type `slim` — `REGISTER_IO_USERTYPE(slim, Squeezebox)`,
`Audio/Squeezebox.cpp`) and `RoonPlayer` (io type `Roon`,
`Audio/RoonPlayer.cpp`). Commands ride the ordinary `set_state` message;
state is read back via `get_state`; live changes arrive as events.

## get_home: the `audio` array

`{msg:"get_home"}` → `{msg:"get_home", data:{home:[...], cameras:[...], audio:[...]}}`
(`JsonApiHandlerWS::processGetHome`). Each audio entry is **basic info only**
(`JsonApi::buildJsonAudio`, `src/bin/calaos_server/JsonApi.cpp`):

```json
{
  "id": "audio_1",
  "name": "Salon",
  "type": "slim",
  "playlist": "true",
  "database": "true",
  "avr": "avr_1"
}
```

- `playlist` / `database` — `canPlaylist()` / `canDatabase()` capability flags.
- `avr` — only present when the player has an `amp` param (linked AV receiver).
- **There is NO `status`, `volume`, `position` or `current_track` here.** The
  upstream comment in `buildJsonAudio` says so explicitly: detailed infos must
  be fetched per player via `get_state` so `get_home` isn't delayed by
  round-trips to the media server. (The old web app's assumption that
  `current_track` rides in `get_home` matches no released calaos_base source —
  checked on master and `v3.0-rc1`.)

Because `buildJsonRoomIO` serialises every IO of a room without filtering
(`JsonApi.cpp`), a player configured inside a room may *also* appear in that
room's `items` with `gui_type:"audio_player"`, `visible:"false"`. Clients must
ignore it there (the visible filter already does).

## get_state: detailed player state

Request (`JsonApiHandlerWS::processGetState` → `JsonApi::buildJsonState`):

```json
{"msg":"get_state", "msg_id":"1", "data":{"items":["audio_1", "output_1"]}}
```

Response `data` is a flat map. Plain IOs map to their state string; ids whose
IO has `gui_type == "audio_player"` map to an object:

```json
{
  "msg": "get_state", "msg_id": "1",
  "data": {
    "output_1": "true",
    "audio_1": {
      "playlist_current_track": "1",
      "volume": "35",
      "playlist_size": "3",
      "time_elapsed": "42.5",
      "status": "playing",
      "current_track": { "title": "…", "artist": "…", "album": "…", "duration": "243.435", "…": "…" }
    }
  }
}
```

- `status` ∈ `playing | pause | stop | error | song_change`
  (`buildJsonState`'s switch over `AudioPlayer::get_status`). **Asymmetry**:
  events use `play`, `get_state` uses `playing`.
- `time_elapsed` — seconds as a decimal string (`get_current_time` double).
- `current_track` — pass-through of the backend's song info
  (`AudioPlayer::get_songinfo`). Squeezebox forwards LMS `songinfo …
  tags:algjdro` key/values (typically `id,title,artist,album,genre,coverart,
  duration,bitrate,type` — `Squeezebox::get_songinfo_cb2`); for remote streams
  (radio) it falls back to `{artist, album, title, duration, coverart:"1"}`
  (`get_songinfo_artist_cb…get_songinfo_duration_cb`). Roon returns
  `{title, artist, album, duration}` (`RoonPlayer::get_songinfo_cb`).
  **Treat keys beyond title/artist/album/duration as optional.**
- Unknown ids are silently omitted. A `get_state` without `data` is answered
  without `data` (`processGetState`).

## Transport & volume commands: `set_state`

Commands are ordinary `set_state` frames against the player id
(`JsonApiHandlerWS::processSetState` → `JsonApi::decodeSetState` →
`AudioPlayer::set_value`, `Audio/AudioPlayer.cpp`):

```json
{"msg":"set_state", "data":{"id":"audio_1", "value":"play"}}
```

| `value` | Effect (AudioPlayer::set_value) |
|---|---|
| `play` / `pause` / `stop` | transport |
| `next` / `previous` | playlist navigation (note: `previous`, **not** `prev`) |
| `volume set 55` | absolute volume 0-100 |
| `volume up 5` / `volume down 5` | relative volume (arg required) |
| `power on` / `power off` | player power |
| `sleep 300` | sleep timer (seconds) |
| `sync <playerid>` / `unsync <playerid>` | multi-room sync |
| `play <items>` / `add <items>` | play/enqueue database items |

- `set_value` **always returns true**, and always emits an `io_changed` event
  echoing the raw command string as `state` (see Events). Unknown values are
  swallowed (echo only).
- The server replies `{"msg":"set_state","msg_id":…,"data":{"success":"true"|"false"}}`
  **only when the request carried a `msg_id`** (`processSetState`);
  `success:"false"` only means "unknown IO id" for players.
- **There is no seek command.** `AudioPlayer::set_current_time(double)` exists
  on the C++ class (implemented in `Squeezebox.cpp`) but no JSON API path ever
  calls it, and `set_value` has no time/seek prefix. Position is read-only for
  clients (display only).
- Volume readback: `get_state` (field `volume`) or the
  `audio_volume_changed` event. There is no dedicated volume query message.

## Events

Envelope (`JsonApiHandlerWS::handleEvents` → `CalaosEvent::toJson`,
`src/bin/calaos_server/EventManager.cpp`):

```json
{
  "msg": "event",
  "data": {
    "event_raw": "audio_status_changed player_id:audio_1 state:play",
    "type": "19",
    "type_str": "audio_status_changed",
    "data": { "player_id": "audio_1", "state": "play" }
  }
}
```

`event_raw` is `type_str` plus url-encoded `key:value` pairs
(`CalaosEvent::toString`); `type` is the numeric enum value as a string
(`EventManager.h` enum: `audio_song_changed`=13, `audio_status_changed`=19,
`audio_volume_changed`=20). Dispatch on `type_str`, ignore the rest.

| `type_str` | `data` payload | Emitted from |
|---|---|---|
| `audio_song_changed` | `{player_id}` | `Squeezebox.cpp` `processNotificationMessage`; `RoonPlayer.cpp` `state_update_cb` |
| `audio_status_changed` | `{player_id, state: "play"\|"pause"\|"stop"}` | same |
| `audio_volume_changed` | `{player_id, volume: "0"–"100"}` | same |
| `playlist_tracks_added` | `{player_id}` | `Squeezebox.cpp` |
| `playlist_tracks_deleted` | `{player_id, position}` | `Squeezebox.cpp` |
| `playlist_tracks_moved` | `{player_id, from, to}` | `Squeezebox.cpp` |
| `playlist_reload` | `{player_id}` | `Squeezebox.cpp` |
| `playlist_cleared` | `{player_id}` | `Squeezebox.cpp` |

⚠️ The old app's TODO names (`audio_status`, `audio_volume`,
`audio songchanged`) are **wrong** — they never existed under those names in
any calaos_base source read. Use the `type_str` values above.

Additionally, players emit plain `io_changed` events (`type_str:"io_changed"`,
payload keyed by `id`, not `player_id`):

- `{id, state: "<raw command>"}` — unconditional echo at the end of
  `AudioPlayer::set_value` (e.g. `state:"volume set 55"`).
- `{id, state: "onplay"|"onpause"|"onstop"|"onsongchange"|"onplaylistchange"|"onvolumechange"|"onerror"}`
  — `AudioPlayer::hasChanged` whenever the internal status flips (these feed
  the rules engine's `onplay`… conditions). Clients must tolerate `io_changed`
  frames whose `id` is an audio player / whose `state` is not an IO state.

There is no `audio_time_changed`: position must be polled (`get_time` below)
while a player is `playing`.

## Audio queries: `{msg:"audio"}`

`{"msg":"audio","data":{"audio_action":…, "id":"<player>", …}}` →
`{"msg":"audio","data":{…}}` (`JsonApiHandlerWS::processAudio` +
`JsonApi::audioGet*`, `JsonApi.cpp`):

| `audio_action` | Extra request keys | Response `data` |
|---|---|---|
| `get_playlist_size` | — | `{"playlist_size":"3"}` |
| `get_time` | — | `{"time_elapsed":"42.5"}` |
| `get_playlist_item` | `item` (index as string) | one track object (songinfo keys; `{}` when out of range) |
| `get_cover_url` | — | `{"cover":"<absolute URL or empty>"}` |

Errors (exact upstream strings, typos included): `{"error":"unkown audio_action"}`,
`{"error":"empty player id"}` (missing `id`), `{"error":"unkown player_id"}`,
`{"error":"wrong item"}` (`getAudioPlayer` / `audioGetPlaylistItem`).

### `{msg:"get_playlist"}`

`{"msg":"get_playlist","data":{"id":"audio_1"}}` →
`{"current_track":"<index>","count":"<n>","items":[<track>…]}` — note
`current_track` is the playlist **index** here, not a track object
(`JsonApi::decodeGetPlaylist` / `getNextPlaylistItem`). Unknown/non-player id
→ `{"success":"false"}`.

### `{msg:"audio_db"}` (music library browsing — out of T17 scope)

Same dispatch style with `audio_action` ∈ `get_stats, get_album, get_artists,
get_artist_album, get_years, get_year_albums, get_genres, get_genre_artists,
get_album_titles, get_playlists, get_playlist_titles, get_music_folder,
get_search, get_radios, get_radio_items, get_track_infos`
(`JsonApiHandlerWS::processAudioDb`). Paged actions take `from`/`count`;
results are `{total_count, items:[…]}` (`JsonApi::processDbResult`). Only
available when the player's `database` flag is `"true"`. Denied to
service-scope (MCP) sessions.

## Cover art

Two retrieval paths, both verified:

1. **WS `get_cover_url`** → `{"cover": "<url>"}` — the URL points at the
   *media server*, not calaos_server: LMS
   `http://<lms-host>:<web-port>/music/<artwork_track_id>/cover.jpg` or a
   remote `artwork_url` (`Squeezebox::get_album_cover*`), Roon's
   `playerState.cover_url` (`RoonPlayer::get_album_cover_cb`). Empty string
   when no artwork is available (`JsonApi::audioGetCoverInfo` passes
   `svalue` through). The URL may be unreachable from the browser's network —
   always have a fallback.
2. **HTTP `POST /api` `{action:"get_cover", id, width?}`** (+ `cn_user`/
   `cn_pass` in the JSON body) — calaos_server downloads and re-encodes the
   cover itself and answers
   `{"success":"true","contenttype":"image/jpeg","encoding":"base64","data":"<base64>"}`
   (`JsonApiHandlerHttp::processGetCover` / `exeFinished`,
   `src/bin/calaos_server/JsonApiHandlerHttp.cpp`). Failures:
   `{"success":"false","error_str":"id not set"}` (bad id) or
   `{"…":"unable get url"}`; bad credentials get a plain HTTP 400 page
   (`JsonApiHandlerHttp::processApi`). `width` scales the thumbnail.

## Known upstream quirk (do not copy)

The bundled MCP sidecar client sends `{"msg":"audio","data":{"player_id":…,
"action":"play"}}` (`src/bin/calaos_mcp/python/calaos_mcp/client.py`), but
`processAudio` only reads `audio_action`+`id` and knows no transport actions —
that path answers `{"error":"unkown audio_action"}` on master. Transport goes
through `set_state`, full stop.

## Unverified — validate against 192.168.30.17 during T17/T20

Could not be confirmed from source alone; each with the proposed fallback:

- **The live server's version/shape.** Everything above is master
  (`ac5a6b3`). `buildJsonAudio` is identical back to `v3.0-rc1`, so drift is
  unlikely, but the smoke test should diff a real `get_home`/`get_state`
  against this spec. Fallback: tolerant parsing — every player field optional.
- **`current_track` key set on a real LMS** (exact tags LMS returns per
  media type). Fallback: render title/artist/album/duration when present,
  hide labels otherwise.
- **`time_elapsed` float formatting** (`Utils::to_string(double)` precision).
  Fallback: `parseFloat`, never string-compare.
- **`event_raw` exact url-encoding charset** (`Utils::url_encode`). Fallback:
  never parse `event_raw`; dispatch on `type_str` only.
- **Whether a stopped LMS resets `time_elapsed` to 0** (mock assumes yes).
  Fallback: clamp display to `[0, duration]`.
- **`volume up`/`volume down` without an argument** (source requires the
  trailing space + number; behaviour otherwise is undefined). Fallback:
  always send an explicit amount, e.g. `volume up 5`.
- **Reachability of the `get_cover_url` URL from the browser** (it targets
  the LMS/Roon host, possibly another VLAN). Fallback: on image error, retry
  via `POST /api get_cover` (base64), then placeholder art.
- **Whether the deployed server has any audio players configured.** Fallback:
  hide the audio section when `get_home.audio` is empty (T17 AC).

## Mock coverage (`mock-server/`)

Implemented against this spec (see `mock-server.test.mjs` "audio:" suites):

- `fixtures/home.json`: 2 players in the real `buildJsonAudio` shape —
  `audio_1` (`slim`, playlist+database) and `audio_2` (`Roon`, `avr`,
  no database). `fixtures/audio.json`: per-player runtime seed (status,
  volume, elapsed, playlist; `audio_1` = local library with full LMS tags,
  `audio_2` = remote radio stream with reduced metadata and no artwork).
- `get_state` (flat map + player object expansion, `msg_id` echo, data-less
  form), running `time_elapsed` clock (playing advances, pause freezes,
  stop zeroes).
- `set_state` commands: `play/pause/stop/next/previous/volume set|up|down`,
  with the real frame sequence — raw-command `io_changed` echo, then
  full-envelope `audio_*` event + `on<state>` `io_changed` on actual change;
  unknown commands echo-only; reply `{success}` only when `msg_id` present.
- `audio` queries: all four `audio_action`s incl. exact error strings;
  `get_playlist`; `msg_id` echo everywhere.
- Cover art: `get_cover_url` → `http://127.0.0.1:<port>/music/17/cover.jpg`
  served by the mock (image/jpeg, no auth — like a real LMS); empty cover for
  `audio_2`; `POST /api {action:"get_cover"}` with the upstream success/error
  envelopes and `fixtures/cover.jpg` as base64.
- `/control {op:'push_audio', id, status?, volume?, track?}` to force state +
  events from tests/E2E (unknown ids still broadcast, like `push_io`).

Deliberate mock deviations (documented, harmless to T17):

- `io_changed` keeps the mock's reduced envelope (`{type_str, data}`, no
  `event_raw`/`type`) for backward compat with existing tests; audio events
  use the full envelope.
- `set_state` success approximation: `false` for unknown ids and read-only
  inputs, `true` otherwise (upstream returns the per-IO `set_value` result).
- No `audio_db`, playlist-mutation commands (`playlist …`), `power`/`sleep`/
  `sync` effects, or `playlist_*` events (T17 doesn't need them; extend the
  mock when a task does).
- `time_elapsed` rounds to 0.1 s; volume clamps at 0/100 immediately (a real
  LMS notifies asynchronously).
