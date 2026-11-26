# API contracts

The contracts between the app, the database and the music providers: RPC functions, realtime events, provider adapters and shared types.

> **Status: confirmed by the RPC contracts card (2026-11-24).** The conventions in §1 and the error codes in §2 are built (`supabase/migrations/20261124000200_rpc_foundation.sql`). Each operation in §3 is built by its own card; until then it's the agreed shape. If the implementation needs a different shape, change this file in the same PR. Items marked **Added** aren't in the original plan's operation list. The product rules need them, and the RPC contracts card confirmed them all.

Why it's shaped this way: [ARCHITECTURE.md § 4.10](ARCHITECTURE.md#410-client-vs-server-authority).

## 1. Conventions

- **RPC = a Postgres function**, called with `supabase.rpc('<name>', { ...args })`. Names and arguments are `snake_case`. TypeScript types use `camelCase` and are mapped at the edge in `src/services`.
- **Clients never insert into, update or delete from room tables directly.** RLS only lets members read. Every write goes through a function below.
- **Every function checks in this order** (helpers in the `private` schema, which the API doesn't expose):
  1. signed in (`private.require_user()`; also `private.require_complete_profile()` where the operation needs a finished profile),
  2. the room exists and is in the right state (`private.lock_room()`, which also locks the room row so mutations of one room run one at a time),
  3. the caller is a member (`private.require_member()`),
  4. the caller's role allows the action (`private.require_host()`, or `private.require_allowed()` for the room rules),
  5. capacity (the 15-person cap is also a trigger on `room_members`),
  6. idempotency,
  7. the operation's own rules.
- **A replay is answered first.** Right after the sign-in check, `private.idempotency_replay()` looks up the key. A stored result is returned before checks 2–7 run, because the state they read may have changed since (for example, retrying `end_room` after the room ended must still succeed). A new key goes through every check.
- **Functions return `jsonb`** objects with the snake_case fields listed under Returns, so a stored result replays exactly. Argument names are exactly the ones listed under Input, because `supabase.rpc` passes arguments by name.
- **Idempotency.** Every mutation takes `idempotency_key uuid`. The client creates one key per user intent (one tap) and reuses it on retries.
  - The server stores `(user_id, operation, idempotency_key)` with the successful result. A repeat call returns the stored result without repeating the effect.
  - The same key with different arguments fails with `idempotency_conflict`.
  - Only successful results are stored, so a rejected call (for example `already_in_queue`) can be retried with the same key.
  - Keys are kept for at least 24 hours (`idempotency_keys.expires_at`). After that the key counts as new. `private.purge_expired_idempotency_keys()` deletes expired rows; a scheduled job should call it.
  - Arguments are compared by a SHA-256 hash of their `jsonb` form, which is canonical.
  - A transaction-level lock on the key makes a second request with the same key wait for the first to finish.
- **Errors** carry a stable string `code` from [§ 2](#2-error-codes). The app maps codes to copy and never shows raw database messages.
  - The database raises them with `private.raise_error(code, details)`: SQLSTATE `P0001`, the code as the message, extra fields as JSON in the detail, and the hint `qd`. Through `supabase-js` that's `error.message === 'room_full'`, `error.hint === 'qd'` and `JSON.parse(error.details)` for fields like `retry_after_seconds`. Anything without the `qd` hint is unexpected and maps to generic copy.
  - Edge Functions answer with the same codes as JSON: `{ "code": "not_authenticated" }`.
  - **Errors that must keep a side effect** (a failed join attempt, which the attempt limits count) are answered with `private.error_response(code, details)` instead: the function sets PostgREST's `response.status` to 400 and returns `{ code: 'P0001', message: <code>, details, hint: 'qd' }`. PostgREST commits a transaction that didn't fail, and supabase-js reports the same `error` a raise would. Used only for a code or invite token that matched nothing.
  - `private.raise_error` refuses a code that isn't in § 2, and a test checks the list matches the table.
- **Built (live room screens card): the app's RPC client** is `src/services/rpc.ts` (`callRpc`), with the room and queue calls in `src/services/rooms.ts`. It reads both error paths the same way, adds the client-only `network` and `unexpected` (never sent by the server, so not in § 2), and keeps a call's key for a retry when it got no answer (`features/room/useCall.ts`).
- **Validation on the way in.** The app parses every RPC result and realtime payload with a Zod schema from `src/domain`. Anything that doesn't parse is logged (redacted) and treated as "refetch".
- IDs are UUIDs. Times are `timestamptz` from the server clock. Durations and positions are integer milliseconds.

## 2. Error codes

| Code | Meaning |
|---|---|
| `not_authenticated` | No valid session |
| `profile_incomplete` | Onboarding (name, color, 18+) not finished |
| `room_not_found` | No such room, or the caller can't see it |
| `room_ended` | The room has ended |
| `not_member` | The caller isn't in the room |
| `not_host` | Only the host can do this |
| `not_allowed` | The room's rules don't let the caller do this ([PRODUCT_SPEC.md §4](PRODUCT_SPEC.md#who-can-do-what)) |
| `room_full` | 15 signed-in participants already |
| `code_invalid` | Wrong or expired room code. Both cases return the same error, so codes can't be probed. |
| `invite_invalid` | Wrong, expired or revoked QR invite token |
| `rate_limited` | Too many attempts. Includes `retry_after_seconds`. |
| `provider_required` | This device needs a connected music service to do this |
| `provider_unavailable` | The music service couldn't answer: unreachable, timed out, rejected q’d's credentials or sent something unexpected. Includes `provider` and `reason`. Edge Functions only (catalog search). (Added) |
| `already_in_queue` | The recording is already queued. Retry with `allow_duplicate: true` after the user confirms. |
| `entry_not_found` | The queue entry was removed or already played |
| `stale_state` | The caller acted on an old view (for example, skipping a song that already changed). Refetch and retry. |
| `import_in_progress` | Another playlist import is running in this room |
| `limit_exceeded` | Over a fixed limit, for example 50 songs per import |
| `idempotency_conflict` | Same key, different arguments |
| `feature_disabled` | Behind a feature flag that's off (`sync`, playlist import), or not built yet (the `delete-account` placeholder) |
| `invalid_input` | An argument is missing or out of range, for example a blank room name or no idempotency key. Includes `field`. (Added) |
| `not_between_songs` | **Added.** The song has started, and services only change between songs (`switch_playback_provider`) |
| `not_needed` | **Added.** The song is already on the room's service, or isn't on the one asked for (`switch_playback_provider`) |

## 3. RPC functions

### Rooms

#### `create_room`

**Built** (`supabase/migrations/20261124000400_create_room.sql`).

- **Caller:** any signed-in user with a finished profile and a connected service (checked against `provider_connections`).
- **Input:** `name text` (trimmed, 1–40 characters), `playback_provider 'apple_music' | 'spotify'`, `add_songs room_audience = 'everyone'`, `control room_audience = 'host'`, `mode playback_mode = 'aux'`, `idempotency_key uuid`. `room_audience` is `'everyone' | 'chosen' | 'host'`.
- **Effect:** creates a live room in `aux` mode with the rules chosen on Start a room. Nobody is chosen yet. The caller becomes host and the first member, and the room gets a `stopped` playback state. Generates a six-character code (see § 7), unique among rooms that haven't ended, valid for 24 hours.
- **Returns:** `{ room_id, code, code_expires_at }`. `code` has no `QD-` prefix; the app adds it for display.
- **Errors:** `not_authenticated`, `profile_incomplete`, `feature_disabled` (`mode: 'sync'`, `details.flag = 'sync'`), `invalid_input` (`details.field`: `name`, `playback_provider`, `add_songs`, `control`, `mode` or `idempotency_key`), `provider_required` (`details.provider`, when the caller hasn't connected the service the room plays through), `idempotency_conflict`
- **Note:** `mode` is always `aux`. A `sync` room needs the `sync` flag and fails with `feature_disabled`.
- **Capacity:** the room starts with one participant. The 15-person cap is enforced when people join.

#### `join_room_by_code`

**Built** (`supabase/migrations/20261125001000_join_room_by_code.sql`).

- **Caller:** any signed-in user with a finished profile. No music service needed.
- **Input:** `code text`, `idempotency_key uuid`. The code is case-insensitive, and the `QD-` prefix, spaces and dashes are optional.
- **Checks:** sign-in, replay, finished profile, then the attempt limits (§ 7) per user and per IP address, applied before looking up the code. The code must belong to a room that hasn't ended, and `code_expires_at` must be later than now.
- **Effect:** adds the caller as a member and broadcasts `members.changed`. If they're already a member (the host included), it succeeds without a change or a broadcast.
- **Returns:** `{ room_id }`
- **Errors:** `not_authenticated`, `profile_incomplete`, `invalid_input` (`field: 'idempotency_key'`), `rate_limited` (`retry_after_seconds`), `code_invalid`, `room_full`, `room_ended` (only if the room ends between the lookup and the join; an ended room's code is `code_invalid`), `idempotency_conflict`
- **Note:** `code_invalid` is answered with `private.error_response()` instead of being raised, so the failed attempt is kept (§ 1, Errors). The client sees the same `error`.

#### `update_room_rules` (Added)

- **Caller:** host. The host changes the room rules in Listeners.
- **Input:** `room_id uuid`, `add_songs room_audience`, `control room_audience`, `add_songs_chosen uuid[]`, `control_chosen uuid[]`, `idempotency_key uuid`. The chosen lists are user ids and are kept even while their rule isn't `chosen`.
- **Effect:** replaces the room's rules. Realtime tells the other phones to refetch, so their controls follow the new rules straight away.
- **Errors:** `not_host`, `not_member` (a chosen id isn't in the room)

#### `create_room_invite` (Added)

**Built** (`supabase/migrations/20261125001100_room_invites.sql`).

- **Caller:** host. QR invites need a token separate from the room code, and something has to create it.
- **Input:** `room_id uuid`, `idempotency_key uuid`
- **Effect:** creates a high-entropy token (32 random bytes from two v4 UUIDs, 244 bits, as 43 unpadded base64url characters) that works for 24 hours, and revokes any older invite of the room. Only the token's SHA-256 hash is stored, in `room_invites.token_hash`.
- **Returns:** `{ token, expires_at }`. The QR code encodes `qd://join?invite=<token>`, which opens the app's `/join` route (`buildInviteLink` and `parseInviteLink` in `src/domain/invite-link.ts`). Universal links can come later.
- **Errors:** `not_authenticated`, `invalid_input` (`field: 'idempotency_key'`), `room_not_found`, `room_ended`, `not_member`, `not_host`, `idempotency_conflict`
- **Replay:** the stored result holds the invite's id and expiry, never the token. A replay gives the same invite a fresh token (same row, same `expires_at`) and the token from the lost response stops working. If that invite is no longer live (replaced, expired, or its room ended), the key counts as new and goes through every check.
- **Note:** the server keeps only a hash, so the host's phone keeps the token it got and reuses it while the app runs (DECISIONS 2026-11-25 · Invite / QR screen). The mock answers with deterministic `mock-…` tokens.

#### `join_room_by_invite` (Added)

**Built** (`supabase/migrations/20261125001100_room_invites.sql`).

- **Caller:** any signed-in user with a finished profile who scanned a QR code. No music service needed.
- **Input:** `token text`, `idempotency_key uuid`
- **Checks:** sign-in, replay, finished profile, then the attempt limits (§ 7, counted separately from codes) before the lookup.
- **Effect, returns:** the same as `join_room_by_code`: `{ room_id }`, and `members.changed` for a new member.
- **Errors:** `not_authenticated`, `profile_incomplete`, `invalid_input` (`field: 'idempotency_key'`), `rate_limited` (`retry_after_seconds`), `invite_invalid` (unknown, malformed, revoked or expired token), `room_ended` (a real token whose room ended), `room_full`, `idempotency_conflict`
- **Note:** an unknown token is counted as a failed attempt and answered with `private.error_response()` (§ 1, Errors). Malformed, revoked and expired tokens aren't guesses, so they aren't counted.

#### `leave_room` (Added)

- **Caller:** a member who isn't the host. A host ends the room instead, because host transfer is post-demo.
- **Input:** `room_id uuid`, `idempotency_key uuid`

#### `end_room`

- **Caller:** host. `delete_account` also calls it.
- **Input:** `room_id uuid`, `idempotency_key uuid`
- **Built** (`supabase/migrations/20261125001200_end_room.sql`). Since the demo reset card, it ends the room through `private.close_room()` (`20261125005000_reset_demo_accounts.sql`), which `reset_demo_accounts` shares.
- **Effect:** marks the room ended (`state = 'ended'`, `ended_at`), stops playback (`playback_states.status = 'stopped'`), expires its code (`code_expires_at` no later than `ended_at`; the code is free for new rooms) and revokes its live invite. Broadcasts `room.ended`. Members and the queue are kept as history that members can still read; the 90-day cleanup is a later card.
- **Returns:** `{ room_id, ended_at }`
- **Errors:** `not_authenticated`, `invalid_input` (`field: 'idempotency_key'`), `room_not_found`, `room_ended` (with a new key), `not_member`, `not_host`, `idempotency_conflict`
- **Replay:** answered before the other checks, so a retry with the same key after the room ended returns the stored result and broadcasts nothing again.

### Queue

#### `enqueue_recording`

**Built** (`supabase/migrations/20261125002000_enqueue_recording.sql`, tests in `supabase/tests/enqueue-recording.test.ts`).

- **Caller:** any member the room's add-songs rule allows (`not_allowed` otherwise). The default is everyone.
- **Input:** `room_id uuid`, `recording_id uuid`, `allow_duplicate boolean = false`, `idempotency_key uuid`
- **Effect:** inserts a queue entry at the end, with a position the server assigns while holding the lock on the room row (`private.lock_room`), so additions made at the same moment get one authoritative order. Sends `queue.changed` from inside the transaction.
- **Returns:** `{ entry_id, position, queue_length }`. The app uses `queue_length` for "Rain Down added · 8th in line". `position` is the entry's place in line (1 = next), or 0 when it started playing.
- **Errors:** `already_in_queue` (unless `allow_duplicate`; `details.status` is `queued` or `playing`, so the app can ask "Already in queue" or "Playing now"), `room_not_found`, `room_ended`, `not_member`, `not_allowed`, `invalid_input` (`details.field`: `room_id`, `recording_id` (missing or not a known recording), `allow_duplicate` or `idempotency_key`), `idempotency_conflict`, `not_authenticated`. A song counts as already in the queue while it's queued or playing; played and removed entries don't count.
- **Confirmed (RPC contracts card):** when nothing is playing, the new entry becomes the playing one and `queue_length` is 0, so the toast says "playing now". The mock store does this.
- **Note:** `recording_id` comes from a catalog search result: `catalog-search` saves every result as a `recordings` row and returns its id ([§ Catalog](#catalog)).

**Queue positions (decided 2026-11-25).** Queued entries hold dense integer positions `1..n` in play order; the playing entry holds `0`; played and removed entries keep their last position, which means nothing. Only RPCs write positions, always under the room lock, and a unique index on queued positions per room backs it up. Clients sort by `position` and never compute one.

#### `enqueue_batch` (post-demo, `playlist_import` flag)

**Built, flag off** (`supabase/migrations/20261125002100_enqueue_batch.sql`, tests in `supabase/tests/enqueue-batch.test.ts`). The app has no entry point to it until the playlist-import card.

- **Caller:** any member the room's add-songs rule allows, who created the batch.
- **Input:** `room_id uuid`, `batch_id uuid`, `recording_ids uuid[]` (1–50, in playlist order), `idempotency_key uuid`
- **Before it:** the import preview (playlist-import card) creates the `playlist_import_batches` row in `previewing` status. `enqueue_batch` doesn't create batches.
- **Effect:** under the room lock, marks the batch `importing`, adds the entries in playlist order under its `batch_id` (the same helper as `enqueue_recording`, so an empty room starts the first song), then marks it `done` with its counts. Songs already queued or playing, and repeats inside the batch, are skipped, because a batch can't ask "Already in queue" per song. Sends one `queue.changed` for the whole batch. Only one import runs per room at a time.
- **Returns:** `{ batch_id, added, skipped }`
- **Errors:** `feature_disabled` (`details.flag = 'playlist_import'`), `limit_exceeded` (over 50, `details.limit`), `import_in_progress` (another batch in the room is `importing`), `stale_state` (the batch isn't `previewing` anymore, `details.status`), `invalid_input` (`details.field`: `room_id`, `batch_id` (missing, another room's or another person's), `recording_ids` (missing, empty, a null or an unknown recording) or `idempotency_key`), `not_allowed`, `not_member`, `room_not_found`, `room_ended`, `idempotency_conflict`, `not_authenticated`

#### `undo_batch` (post-demo, Added)

**Built, flag off** (same migration and tests).

- **Caller:** host.
- **Input:** `room_id uuid`, `batch_id uuid`, `idempotency_key uuid`
- **Effect:** marks the batch's entries that are still queued `removed`, closes the gap in positions and marks the batch `undone`. The playing entry and played ones stay. Sends `queue.changed`.
- **Returns:** `{ batch_id, removed }`
- **Errors:** `feature_disabled`, `not_host`, `stale_state` (the batch isn't `done`, `details.status`), `invalid_input` (`room_id`, `batch_id`), `not_member`, `room_not_found`, `room_ended`, `idempotency_conflict`

**Feature flags in the database.** `private.feature_flags` holds server-side switches; `private.require_feature(flag)` raises `feature_disabled` with `details.flag`. Only the database owner changes them (a migration or the dashboard). `playlist_import` starts off.

#### `reorder_queue`

**Built** (`supabase/migrations/20261125002200_reorder_remove_queue.sql`, tests in `supabase/tests/reorder-remove-queue.test.ts`).

- **Caller:** any member the room's control rule allows. The default is the host only.
- **Input:** `room_id uuid`, `entry_id uuid`, `after_entry_id uuid | null` (`null` moves it to the top; the playing entry counts as the top too), `idempotency_key uuid`
- **Effect:** under the room lock, moves a waiting entry to just after `after_entry_id` and shifts the entries in between, so positions stay `1..n`. A move to where the entry already is changes nothing and sends nothing; otherwise it sends `queue.changed`.
- **Returns:** `{ entry_id, position, queue_length }` (the entry's new place in line).
- **Errors:** `not_allowed`, `entry_not_found` (`details.field = 'entry_id'`: removed, played or not in this room; `details.field = 'after_entry_id'`: not in this room), `stale_state` (the entry is playing now, or the entry to follow was removed or played since; `details.field`, `details.status`), `invalid_input` (`room_id`, `entry_id`, `after_entry_id` equal to `entry_id`, `idempotency_key`), `not_member`, `room_not_found`, `room_ended`, `idempotency_conflict`, `not_authenticated`

#### `remove_queue_entry`

**Built** (same migration and tests).

- **Caller:** any member the room's control rule allows. **Confirmed (RPC contracts card):** also the member who added the entry, for the Undo on the "added" toast, while the entry is still queued.
- **Input:** `room_id uuid`, `entry_id uuid`, `idempotency_key uuid`
- **Effect:** under the room lock, marks a waiting entry `removed` (the row stays for history), closes the gap in positions and sends `queue.changed`. The playing entry can't be removed; Skip is `advance_queue`.
- **Returns:** `{ entry_id, queue_length }`
- **Errors:** `entry_not_found` (removed, played or not in this room), `stale_state` (the entry is playing now, `details.status`), `not_allowed`, `invalid_input` (`room_id`, `entry_id`, `idempotency_key`), `not_member`, `room_not_found`, `room_ended`, `idempotency_conflict`, `not_authenticated`
- **Check order:** membership, then the entry, then permission, because whether the caller may depends on who added the entry.
- **Retries:** a replay returns the stored result. A new key for an entry that's already gone fails with `entry_not_found`, so nothing is removed twice.

### Playback

#### `report_playback_state` (Added)

The host's device owns the player, so it reports what the player is doing.

- **Caller:** host.
- **Input:** `room_id uuid`, `entry_id uuid | null`, `status 'playing' | 'paused' | 'stopped' | 'autoplay'`, `position_ms int`, `idempotency_key uuid`
- **Effect:** updates `playback_states` and stamps `reported_at` with the server time. Listeners estimate progress as `position_ms + (now − reported_at)` while the status is `playing`.
- **Note:** `autoplay` covers the case where the queue ended and the provider keeps playing on its own. The app labels it "Autoplay by Apple Music/Spotify".

#### `request_playback` (Added)

Play and pause from a phone that isn't the host's. Only the host's phone plays in `aux`, so it carries the request out.

- **Caller:** any member the room's control rule allows.
- **Input:** `room_id uuid`, `action 'play' | 'pause'`, `idempotency_key uuid`
- **Effect:** records the request. The host's phone gets it over Realtime, plays or pauses, and reports the result with `report_playback_state`.
- **Errors:** `not_allowed`, `room_ended`

#### `advance_queue` (Added)

Moves the room to the next song when the current one ends, is skipped, or isn't available.

- **Caller:** the host's phone for `ended` and `unavailable`. For `skipped`, any member the room's control rule allows.
- **Input:** `room_id uuid`, `from_entry_id uuid`, `reason 'ended' | 'skipped' | 'unavailable'`, `idempotency_key uuid`
- **Effect:** marks `from_entry_id` played and returns the next entry. If `from_entry_id` isn't the current entry anymore, it fails with `stale_state`, so a double tap can't skip two songs.
- **Returns:** `{ next_entry_id | null }`

#### `switch_playback_provider` (Added)

The host's answer to "Not on Spotify" when the song that's up is on another service the host connected (PRODUCT_SPEC.md §6).

- **Caller:** host.
- **Input:** `room_id uuid`, `for_entry_id uuid` (the song the host answered for), `provider 'apple_music' | 'spotify'`, `idempotency_key uuid`
- **Checks, in order:** `not_host`; `stale_state` when `for_entry_id` isn't the current entry; `not_between_songs` when its playback has started; `provider_required` when the host has no `provider_connections` row for `provider`; `not_needed` when the song is already on the room's service or isn't on `provider`.
- **Effect:** sets `rooms.playback_provider` to `provider`, so this song and the ones after it play through it, and records the switch (from, to, entry) so every phone can say "The host switched from Spotify to Apple Music between songs." Broadcasts `room.changed`.
- **Mock:** `features/room/roomStore` `switchProvider`, using `checkSwitch` from `src/domain/provider-switch.ts`.

#### `claim_playback_slot` / `release_playback_slot` (`sync` flag)

- **Caller:** member. The host always holds slot 1.
- **Input:** `room_id uuid`, `idempotency_key uuid`
- **Errors:** `feature_disabled` while `sync` is off, `provider_required`, `limit_exceeded` (15 slots)
- **Built as placeholders:** both functions exist, check sign-in, and fail with `feature_disabled` (`details.flag = 'sync'`).

### Catalog

#### `catalog-search` (Edge Function, Added)

**Built** (`supabase/functions/catalog-search`, migration `20261125003000_catalog_search.sql`). Built, not yet tested against the live Apple Music API (no developer key).

- **Caller:** any signed-in user, with or without a music service. Supabase checks the JWT (`verify_jwt`); the function reads `sub`, so the anon key alone gets `401 not_authenticated`.
- **Input (JSON body):** `query` string (trimmed and whitespace-collapsed, 1–100 characters), `limit` integer 1–25 (default 20), `storefront` two-letter Apple storefront (default `us`, case-insensitive).
- **Effect:** counts one search against the caller's limit (60 a minute, `consume_catalog_search`), searches Apple's catalog for songs with the developer token the function holds, and saves each usable song with `save_catalog_tracks`: an Apple `provider_tracks` row and a canonical `recordings` row with version tags read from the title. Saving the same song again keeps its recording id and refreshes its metadata. No `track_matches` are written; mappings are resolved when playback needs them.
- **Returns:** `200 { storefront, results: [{ recordingId, track, availableOn }] }` in Apple's order, camelCase, with `track` in the `ProviderTrack` shape (§ 6). `artworkUrl` is Apple's template with `{w}`/`{h}` left in; the app sizes it (`src/domain/artwork.ts`). `availableOn` is `['apple_music']`: search can't know about other services. The app parses it with `catalogSearchResponseSchema` (`src/domain/catalog.ts`).
- **Errors:** `400 invalid_input` (`field`: `body`, `query`, `limit`, `storefront` or `method`; Apple answering 404 means an unknown storefront), `401 not_authenticated`, `429 rate_limited` (`retry_after_seconds` and a `Retry-After` header, from q’d's limit or Apple's), `502 provider_unavailable` (`provider`, `reason`: `not_configured`, `unauthorized`, `timeout`, `network`, `upstream_error` or `bad_response`). An unexpected failure (for example the database) is `500 {}` without a code, which the app shows as generic copy.
- **Secrets:** `APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID`, `APPLE_MUSIC_PRIVATE_KEY` (the MusicKit `.p8` text) in Edge Function secrets, never `EXPO_PUBLIC_*`. The function mints a 12-hour ES256 developer token, and mints a new one an hour early or after Apple rejects it.

#### `save_catalog_tracks`, `consume_catalog_search` (service role only)

Called by `catalog-search`, not by apps: `anon` and `authenticated` can't execute them.

- `save_catalog_tracks(tracks jsonb)` returns `[{ provider_track_id, recording_id }]` in input order. At most 25 tracks (`limit_exceeded`), all or nothing (`invalid_input` with `field: 'tracks'` and the element's `index`).
- `consume_catalog_search(user_id uuid, per_minute integer = 60)`: `rate_limited` with `retry_after_seconds` over the limit, per user, in one-minute windows.

### Matching

#### `override_track_match` (Added)

- **Caller:** host, from "Wrong version?".
- **Input:** `room_id uuid`, `recording_id uuid`, `provider`, `provider_track_id text`, `idempotency_key uuid`
- **Effect:** stores a `track_match_overrides` row with who changed it and when, and uses it for this room from then on.

**Built (matching card):** the server stores what `matchRecording` in `src/domain/matching` decides. Its `match` is a `TrackMatch` (§6): `method: 'isrc' | 'score' | 'override'`, `confidence` 0–100, and `warning` set whenever the match isn't automatic. An unavailable recording has `providerTrackId: null` and `confidence: 0`.

**Built (availability and low-confidence states card):** clients never rematch. They read the stored `TrackMatch` through `availabilityOf` in `src/domain/availability.ts`, which returns `playable` (automatic or override), `uncertain` (`warning` set: plays with the warning shown), `unavailable` (`providerTrackId: null`: never plays) or `unknown` (nothing stored yet: the host's phone waits). `canPlayOnHostPhone` is true only for the first two. Proposed for the canonical search card: search results carry the matches already stored for each service (`CatalogResult.matches`, §5), so Add a song can warn before a song is queued.

### Account

#### q’d sign-in (Supabase Auth, client side)

Not an RPC: the app calls Supabase Auth through `src/services/auth.ts` only. Built for email/password and Google.

- `signInWithEmail({ email, password })`, `signUpWithEmail({ email, password }, { emailRedirectTo })`, `signOut()` (this device, `scope: 'local'`), `fetchSavedProfile(userId)` (reads the caller's own `profiles` row) and `onAuthChange(listener)`.
- `signInWithGoogle(redirectTo)` opens Google through Supabase OAuth (PKCE, `skipBrowserRedirect`) and exchanges the returned code. `exchangeAuthCode(code)` and `completeAuthRedirect(url)` finish any PKCE redirect; a code is exchanged once. `authRedirectUrl()` is the `/auth/callback` link; that route accepts `code`, or `error` / `error_code` / `error_description`, in the query or fragment (`parseAuthCallbackUrl` in `src/domain/auth.ts`).
- Each returns `{ ok: true, data } | { ok: false, code: AuthErrorCode }` and never throws. Sign-up's `data.needsEmailConfirmation` is true when the project makes new accounts confirm their email first.
- `AuthErrorCode` (`src/domain/auth.ts`): `invalid_credentials`, `email_not_confirmed`, `email_taken`, `weak_password`, `invalid_email`, `rate_limited`, `signups_disabled`, `method_unavailable`, `cancelled`, `link_expired`, `link_invalid`, `network`, `not_configured`, `unknown`.
- `onAuthChange` reports `{ event, user: { id, email, method, name } | null }`, never tokens, on the tick after Supabase's callback (a listener that calls Supabase inside the callback would wait on its auth lock).

#### Own profile (direct write, client side)

Not an RPC: one of the three direct writes row level security allows (DECISIONS 2026-11-24 · Row level security). `src/services/profiles.ts` only. Built (profile save card).

- `saveOnboardingProfile(userId, { displayName, color })` sends `update profiles set display_name, color, adult_confirmed_at = now() where id = userId` and asks for the `id` back. `updateProfile(userId, { displayName?, color? })` (Settings) sends only what changed and never touches `adult_confirmed_at`.
- The grant is `update (display_name, color, adult_confirmed_at)` to `authenticated`, and the policy allows only `id = auth.uid()`. The table checks `display_name` (1–30 characters, trimmed) and `color` (`#rrggbb`). The app checks the same first, and the color against the design tokens' `avatarSwatches` (`src/domain/profile.ts`).
- Each returns `{ ok: true } | { ok: false, error }` and never throws. `error` is `not_configured`, `not_signed_in` (no row matched: RLS hid it, or `PGRST301`), `network` (no answer, nothing may have been saved), `rejected` (`23514`, `22001`, `42501`, `23502`, `22P02`) or `unknown`.
- `fetchSavedProfile(userId)` (above) reads it back; a finished profile sends sign-in and restart to Home.

#### Own provider connections (direct write, client side)

Not an RPC: the second direct write RLS allows. `src/services/providerConnections.ts` only. Built (provider connection rows card).

- `recordProviderConnection(userId, provider, { storefront? })` inserts `(user_id, provider, last_verified_at[, storefront])`; when the row exists (`23505`) it updates `last_verified_at` (and `storefront`) on `user_id = userId and provider = provider` instead. It isn't a PostgREST upsert, because that would write `user_id` and `provider`, which the grant doesn't allow. `connected_at` is the database's default and is never sent. A storefront is sent only when it's two letters.
- `removeProviderConnection(userId, provider)` deletes that row. Deleting a row that isn't there is fine.
- Each returns `{ ok: true, value } | { ok: false, error }`, `error` being `not_configured`, `not_signed_in` (`42501`, `PGRST301`, or an update that matched nothing), `network` or `unknown`. They never throw.
- No token is ever sent: no parameter can carry one and the table has no column for one (`supabase/tests/schema.test.ts`, `supabase/tests/provider-connection-rows.test.ts`).
- When the app calls them (DECISIONS 2026-11-26 · Record real provider connections): after a real Connect succeeds, on Disconnect of a real connection, when an account starts on a phone (reconcile), and before Start room when an earlier write failed. A mock connection never calls them.

#### `delete_account` (Edge Function)

Runs as an Edge Function, not a database function, because it needs the service role to delete the auth user and to revoke provider authorizations.

- **Placeholder built:** `supabase/functions/delete-account` accepts `POST` with a bearer token and answers `501 { "code": "feature_disabled" }` until the account-deletion card builds it. Other methods get `405 invalid_input`, and a request without a token gets `401 not_authenticated`.

- **Caller:** the user, after signing in again recently.
- **Effect:** the steps in [PRODUCT_SPEC.md § 7](PRODUCT_SPEC.md#account-deletion). It ends hosted rooms through `end_room`, replaces attribution with "Deleted user", and retries until cleanup finishes (within 24 hours).

### Operations

Functions for the team, not the app. The app never calls them, and neither `anon` nor `authenticated` can execute them.

#### `reset_demo_accounts` (operator only)

**Built** (`supabase/migrations/20261125005000_reset_demo_accounts.sql`, tests in `supabase/tests/reset-demo-accounts.test.ts`). Called by `supabase/scripts/reset-demo-accounts.js` ([DEMO_RUNBOOK.md § Reset between rehearsals](DEMO_RUNBOOK.md#reset-between-rehearsals)).

- **Caller:** the service role only. Execute is granted to `service_role` alone, and a call that carries a signed-in user fails with `not_allowed` even if a grant is added by mistake. It runs only while the server flag `demo_reset` (`private.feature_flags`) is on, which only the demo project turns on.
- **Input:** `user_ids uuid[]` (the demo accounts, 1 to 10, repeats count once), `apply boolean` (default `false`: a dry run that changes nothing).
- **Effect** (when `apply`), for those users only: every room they host that hasn't ended is ended exactly like `end_room` (shared `private.close_room()`: ended, code expired and freed, playback stopped, live invites revoked, one `room.ended` broadcast). The queue entries, import batches and memberships of every room they host are deleted; the ended room rows stay. Their idempotency keys and failed join attempts are deleted. Profiles and provider connections are never changed, and rooms other people host are never touched.
- **No idempotency key:** the reset is idempotent by itself. A second run finds nothing to do, changes nothing and broadcasts nothing.
- **Returns:** the same counts for a dry run and a real one, taken before any change: `{ applied, users, rooms_ended, invites_revoked, queue_entries_deleted, import_batches_deleted, memberships_deleted, idempotency_keys_deleted, join_attempts_deleted, memberships_elsewhere, profiles_incomplete, users_without_service }`. The last three are informational: memberships in live rooms other people host (left alone), listed accounts without a finished profile, and listed accounts with no music service connected. No ids, emails or codes.
- **Errors:** `not_allowed` (a signed-in caller), `feature_disabled` (`details.flag = 'demo_reset'`), `invalid_input` (`details.field = 'user_ids'` with `reason` `empty`, `null_id`, or `unknown_user` with a `count`; or `details.field = 'apply'`), `limit_exceeded` (`details.limit = 10`).

## 4. Realtime

### Channels

- One private channel per room: `room:<room_id>`.
- Realtime Authorization (RLS on `realtime.messages`) lets only room members join and listen, and lets them track presence. Built in the RLS card; clients can't send broadcasts at all.
- Clients never send room-state broadcasts. The RPC that made the change sends them, through `private.broadcast_room_event(room_id, type)`, which calls Supabase's `realtime.send()` on the topic `room:<room_id>` as a private broadcast whose event name is the `type` (ARCHITECTURE.md open decision 2, decided 2026-11-24). Because it runs inside the RPC's transaction, a rolled-back change sends nothing.

### Broadcast events

Events are hints to refetch, not data. They carry IDs and a version, never names, emails or song details, so nothing personal travels over the socket and the database stays the only source of truth.

```ts
type RoomEvent = {
  v: 1;                       // envelope version
  type:
    | 'queue.changed'         // add, batch add, reorder, remove, advance
    | 'playback.changed'      // report_playback_state, advance_queue
    | 'members.changed'       // join, leave, removal
    | 'room.ended';
  roomId: string;
  at: string;                 // server time, ISO 8601
};
```

On any event, the client invalidates the matching TanStack queries. On `room.ended`, it leaves the room screen.

**Built (Realtime Broadcast and Presence card):** the client side is `src/services/realtime.ts` and `features/room/useRoomRealtime`. Each event invalidates these queries (`invalidationsFor` in `src/services/roomQueryKeys.ts`, all under `['room', roomId]`):

| Event | Refetches |
|---|---|
| `queue.changed` | queue, playback (adding to an empty room starts the song) |
| `playback.changed` | playback, queue (advancing moves the playing entry) |
| `members.changed` | members, the room row (chosen people) |
| `room.ended` | the whole room, your room list; the room screen says it ended and offers Back to Home |
| anything unreadable (newer `v`, unknown type, another room, malformed) | the whole room |
| the channel reconnects | the whole room (events sent while offline are gone) |

`room.ended` doesn't leave the screen by itself: the room says "This room has ended" and the person taps Back to Home, so nobody is moved without being told why.

### Presence

```ts
type RoomPresence = {
  v: 1;
  userId: string;
  role: 'host' | 'member';
};
```

- Presence drives the "N in the room" count and host detection.
- When the host's presence disappears, listeners show "Host reconnecting" for 30 seconds, then "Paused".
- The host's app also pauses its player if it can't reach Supabase for 30 seconds, so the room and the speaker agree.
- A returning host refetches the room before resuming.
- **Built (Realtime card):** each phone tracks `{ v: 1, userId, role }` with its user id as the presence key, and nothing else. Entries that don't parse are ignored. Before the first sync the host counts as present; a host missing from the first sync counts as never seen (`away`). On the host's own phone, losing the channel counts as the host leaving, so its player pauses after the grace period; on a listener's phone it keeps the host as last seen and shows "You’re offline".
- **Built (host reconnecting card, mock mode):** `hostStatus(presence, now)` in `src/domain/host-presence.ts` decides `connected`, `reconnecting` (with the time left) or `away`, using `HOST_RECONNECT_GRACE_MS` (30 s). Its input is `HostPresence = { present, lastSeenAt }`; `hostPresentIn(entries, hostUserId)` reads it from the channel's `RoomPresence` entries and `nextHostPresence` times a leave from the first sync without the host. The Realtime Broadcast and Presence card plugs in by calling the room store's `setHostPresent(room, present)` (or its TanStack replacement) on every presence sync. Proposed for the RPC card: the pause after the grace period is the room's `playback_states` row going to `paused`, written by the server (a listener's phone can't write it), and the host's Resume is `report_playback_state` after a refetch.

### Versioning

- `v` increases only for a breaking change to an envelope. A client that sees an unknown `type` or a newer `v` ignores the payload and refetches.
- Add new event types instead of changing the meaning of old ones.
- **Built (domain types card):** `parseRoomEvent(payload, expectedRoomId?)` and `parseRoomPresence(payload)` in `src/domain/realtime.ts`. They never throw. They return `{ ok: true, value }` or `{ ok: false, reason, issues }`, where `reason` is `unsupported_version` (any `v` other than 1), `unknown_type`, `wrong_room` (the event names another room than the channel's) or `invalid`. `issues` holds field paths and Zod issue codes only, never payload values, so it's safe to log. Every `ok: false` means "ignore it and refetch". Unknown extra fields are stripped, so nothing personal that a payload carries by mistake reaches the app.

## 5. Provider adapters

From the plan, with `PlaybackCapabilities` filled in. The code lives in `src/providers`.

```ts
type MusicProvider = 'apple_music' | 'spotify';
type PlaybackMode = 'aux' | 'sync';

interface CatalogAdapter {
  provider: MusicProvider;
  search(query: string, market: 'US'): Promise<CatalogResult[]>;
  resolveLink(url: string): Promise<ProviderEntity>;
  getTrack(id: string): Promise<ProviderTrack>;
  getPlaylist?(id: string): Promise<PlaylistPage>;
}

interface PlaybackAdapter {
  provider: MusicProvider;
  capabilities(): PlaybackCapabilities;
  connect(): Promise<ConnectionState>;
  prepare(track: ProviderTrack, startPositionMs?: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  enqueue(tracks: ProviderTrack[]): Promise<void>;
  getState(): Promise<PlayerState>;
  disconnect(): Promise<void>;
}

type PlayerState = {            // this device's player, not the room's PlaybackState (§6)
  status: 'idle' | 'playing' | 'paused';
  track: ProviderTrack | null;
  positionMs: number;
};

type PlaybackCapabilities = {
  inAppAudio: boolean;          // Apple: true. Spotify: false (the Spotify app plays).
  backgroundPlayback: boolean;  // keeps playing with the screen locked
  requiresExternalApp: boolean; // Spotify: the Spotify app must be installed and active
  autoplay: boolean;            // provider can continue after the queue ends
  isMock: boolean;              // true only for mock adapters; the UI labels them
};

type ConnectionState = { isMock: boolean } & (  // isMock: the UI labels mock connections
  | { status: 'connected'; accountLabel?: string }
  | { status: 'needs_authorization' }
  | { status: 'needs_subscription' }   // e.g. no Apple Music subscription or Spotify Premium
  | { status: 'app_not_installed' }    // Spotify
  | { status: 'error'; code: ProviderErrorCode }
);

type CatalogResult = {
  track: ProviderTrack;
  availableOn: MusicProvider[];
  recordingId?: string;         // Added (canonical search card): the saved recording; mocks leave it out
  checkedOn?: MusicProvider[];  // Added (live search card): services availableOn was checked on; missing = all. Live search: ['apple_music']
  matches?: Partial<Record<MusicProvider, TrackMatch>>;  // Added (availability card): stored matches, where resolved
};
type ProviderEntity =
  | { kind: 'track'; track: ProviderTrack }
  | { kind: 'playlist'; provider: MusicProvider; playlistId: string };
type PlaylistPage = {
  provider: MusicProvider;
  playlistId: string;
  name: string;
  tracks: ProviderTrack[];
  nextCursor: string | null;
};

type ProviderErrorCode =
  | 'not_in_this_build'  // the real adapter isn't in this build yet
  | 'not_found'
  | 'unsupported_link'   // not an Apple Music or Spotify link q’d reads
  | 'wrong_provider'     // e.g. a Spotify track given to the Apple player
  | 'invalid_argument'    // e.g. a negative seek position
  // Added by the Spotify connection card:
  | 'not_configured'      // no client ID (or other setup) in this build
  | 'needs_authorization' // not connected, or access revoked: reconnect
  | 'auth_failed'         // sign-in didn't finish: state mismatch, refused code exchange
  | 'premium_required'    // Spotify Premium (or a subscription) needed
  | 'not_approved_user'   // Spotify development mode: not on the app's user list
  | 'no_active_device'    // Spotify: no Spotify app open to control
  | 'playback_refused'    // the provider refused the command
  // Added by both the canonical search and the Spotify connection cards:
  | 'rate_limited'        // too many requests; ProviderError.retryAfterSeconds says when
  | 'provider_unavailable'; // offline, or the service (or q’d's server in front of it) failed
```

**Built (provider adapters card)** in `src/providers`: the interfaces (`types.ts`), `ProviderError` (`errors.ts`), the share-link parser (`links.ts`), the mocks (`mock/`), and Apple Music and Spotify stubs (`apple/`, `spotify/`, `unavailable.ts`). Changes from the sketch above, marked here for review:

- **`getState` returns `PlayerState`,** not `PlaybackState`. The adapter knows one device's player; `PlaybackState` (§6) is the room's state the host reports, with a room and entry id the adapter doesn't have.
- **`ConnectionState` carries `isMock`,** and a connected state may carry an `accountLabel`. The error `code` is a `ProviderErrorCode`.
- **`ProviderTrack` gained `album`** (§6), because matching scores album context.
- **`getPlaylist` takes an optional cursor** for the next page.
- **Mocks claim no capability.** They play no audio, so every capability is `false` and `isMock` is `true`.
- **The Apple Music adapters and the Spotify catalog are stubs** (Spotify playback and connection are built, see below) until their cards land and are tested on an iPhone. `connect` returns `{ status: 'error', code: 'not_in_this_build', isMock: false }`, every other call rejects with that code, they claim no capability, and `disconnect` resolves (nothing to undo). The app still uses the mocks, because `mock` is the only data mode.
- **Spotify connection (Spotify connection card; built, untested on device).** `connectProvider(provider)` and `disconnectProvider(provider)` in `src/providers/index.ts` are what Connect and Disconnect call. With the `realSpotify` flag off (the default) they use the mock. With it on, Spotify's Connect runs Authorization Code with PKCE and returns a `ConnectionState`: `connected`; `needs_authorization` (cancelled, or access revoked); `needs_subscription` (Premium required); or `error` with `not_configured`, `auth_failed`, `not_approved_user`, `rate_limited` or `provider_unavailable`. A real Spotify state always has `isMock: false`. Disconnect clears the tokens on this phone.
- **Spotify playback (Spotify playback card; built, untested on device).** `SpotifyPlaybackAdapter` in `src/providers/spotify/playback.ts` replaces the Spotify playback stub (the Spotify catalog is still a stub). `createPlayback('spotify')` returns it with the `realSpotify` flag on. How it fills the interface: `prepare` sends nothing and `getState` reports the prepared track as `paused`; `play` starts it by URI at the position, moving playback to this phone's Spotify if no device is active (`no_active_device` if there's none); `enqueue` adds to Spotify's queue; `getState` reads Spotify's player on every call; `disconnect` pauses what q’d started and lets go, but keeps the account (Disconnect in Settings forgets the tokens). Capabilities: `requiresExternalApp: true`, everything else `false`. 429s wait for `Retry-After` (up to 3 times, at most 10 s each), and 5xx are retried twice except for queue adds.
- The shared contract suite is `src/test/providerContract.ts`. `src/providers/contract.test.ts` runs it against the mocks, the stubs and the Spotify Web API adapter (against a fake Spotify).

**Rules every adapter follows** (the shared contract test suite checks these):

- No adapter claims a capability it doesn't have. Mocks set `isMock: true`.
- `prepare` never starts audio. `play` does.
- Errors surface as typed results or thrown `ProviderError`s with a `code`, never as silent no-ops.
- A track the provider picked itself after the queue ran out is marked `autoplay: true` in the adapter's state, so the host's phone can report status `autoplay` and the app can label it. Only adapters whose `capabilities().autoplay` is true ever mark one. (Added with the autoplay-label card; the mock does this today.)
- Nothing about tokens, emails or listening history reaches the logger unredacted.

## 6. Shared domain types

These are sketches. The domain types card writes them as Zod schemas in `src/domain`, and the TypeScript types are inferred from them.

**Built (domain types card).** Every type below is a Zod schema in `src/domain` (`room.ts`, `recording.ts`, `queue.ts`, `playback.ts`, with `MusicProvider` and `PlaybackMode` in `music-provider.ts`), and `PlaybackCapabilities` from § 5 is in `playback.ts`. What the sketches left open, the schemas pin down:

- IDs are UUIDs and times are ISO 8601 with `Z` or an offset (Postgres `timestamptz`). Durations, positions and counts are non-negative integers. `QueueEntry.position` is any number, because the position representation is still open ([ARCHITECTURE.md, open decision 3](ARCHITECTURE.md#open-technical-decisions)).
- `Room.code` is the six stored characters, uppercase letters and digits, without `QD-`. The character set is still an open question, so the schema only checks the length and case.
- ISRCs are stored in their compact uppercase form (`USRC17607839`). Version tags are lowercase snake case (`sped_up`).
- `PlaylistImportBatch` rejects `addedCount + skippedCount > itemCount`. `PlaybackSlot.slot` is 1–15.
- Unknown extra fields are stripped, so adding a column doesn't break older clients.

```ts
type Room = {
  id: string;
  name: string;
  hostId: string;
  mode: PlaybackMode;             // 'aux' unless the sync flag is on
  state: 'live' | 'paused' | 'ended';
  playbackProvider: MusicProvider;
  code: string;                   // six characters; shown as `QD-${code}`
  codeExpiresAt: string;
  createdAt: string;
  endedAt: string | null;
};

type RoomMember = {
  roomId: string;
  userId: string;
  role: 'host' | 'member';
  displayName: string;
  color: string;
  joinedAt: string;
};

type CanonicalRecording = {
  id: string;
  title: string;
  primaryArtist: string;
  artists: string[];
  album: string | null;
  durationMs: number;
  isrc: string | null;
  explicit: boolean;
  versionTags: string[];          // 'live', 'remix', 'acoustic', 'sped_up', …
};

type ProviderTrack = {
  provider: MusicProvider;
  providerTrackId: string;
  title: string;
  artists: string[];
  album: string | null;           // Added (provider adapters card): matching scores album context
  durationMs: number;
  isrc: string | null;
  explicit: boolean;
  artworkUrl: string | null;
  artworkBackgroundColor: string | null; // Apple only; see the artwork rule
};

type TrackMatch = {
  recordingId: string;
  provider: MusicProvider;
  providerTrackId: string | null; // null = not available on this provider
  confidence: number;             // 0–100
  method: 'isrc' | 'score' | 'override';
  warning: 'low_confidence' | 'explicit_conflict' | null;
};

type QueueEntry = {
  id: string;
  roomId: string;
  recordingId: string;
  position: number;               // server-assigned; clients only sort by it
  addedBy: string | null;         // null after the adder deletes their account
  batchId: string | null;
  status: 'queued' | 'playing' | 'played' | 'removed';
  addedAt: string;
};

type PlaylistImportBatch = {
  id: string;
  roomId: string;
  provider: MusicProvider;
  sourceName: string;
  itemCount: number;
  addedCount: number;
  skippedCount: number;
  status: 'previewing' | 'importing' | 'done' | 'undone' | 'failed';
};

type PlaybackState = {
  roomId: string;
  entryId: string | null;
  status: 'playing' | 'paused' | 'stopped' | 'autoplay';
  positionMs: number;
  reportedAt: string;             // server time
};

type PlaybackSlot = {             // sync (beta) only
  roomId: string;
  slot: number;                   // 1 = host
  userId: string;
  provider: MusicProvider;
  readiness: 'ready' | 'catching_up' | 'sitting_out';
};
```

## 7. Room codes and invite tokens

| | Room code | QR invite token |
|---|---|---|
| Looks like | `QD-7K4F9X` (six characters after the prefix) | 43 URL-safe base64 characters |
| Entropy | Low by design, so people can type it | 244 bits (at least 128 required) |
| Protection | Sign-in required, expiry, collision checks, attempt limits per user and per IP | Unguessable, 24-hour expiry, the host can replace it, ending the room revokes it, attempt limits like codes |
| Stored as | The six characters, uppercase | A hash of the token |

- **Room code character set (decided 2026-11-24):** `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, 32 characters without `0`, `O`, `1` or `I`, so about 1.07 billion codes. Drawn from `gen_random_uuid()`'s random bytes.
- **Room code lifetime (decided 2026-11-24):** 24 hours from creation. The room keeps going after its code expires; only joining by code stops. A code is unique among rooms that haven't ended, and an ended room's code can be drawn again.
- **Attempt limits (decided 2026-11-25):** at most 5 wrong codes per user and 20 per IP address (the first `X-Forwarded-For` entry) in any 10 minutes. Past that, `rate_limited` with `retry_after_seconds` until the oldest failure leaves the window. A success doesn't reset the count. Input that can't be a code isn't counted. Failed attempts are kept in `private.join_attempts`, without the code that was tried and with the IP address hashed.

## 8. Changing a contract

1. Change this file, the Zod schema in `src/domain` and the migration in the same PR.
2. A breaking change to a realtime envelope bumps its `v`.
3. A change to a product rule also gets an entry in [DECISIONS.md](DECISIONS.md).
