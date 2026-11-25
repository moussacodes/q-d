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
| `already_in_queue` | The recording is already queued. Retry with `allow_duplicate: true` after the user confirms. |
| `entry_not_found` | The queue entry was removed or already played |
| `stale_state` | The caller acted on an old view (for example, skipping a song that already changed). Refetch and retry. |
| `import_in_progress` | Another playlist import is running in this room |
| `limit_exceeded` | Over a fixed limit, for example 50 songs per import |
| `idempotency_conflict` | Same key, different arguments |
| `feature_disabled` | Behind a feature flag that's off (`sync`, playlist import), or not built yet (the `delete-account` placeholder) |
| `invalid_input` | An argument is missing or out of range, for example a blank room name or no idempotency key. Includes `field`. (Added) |

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
- **Returns:** `{ token, expires_at }`. The QR code encodes `qd://join?invite=<token>` (`buildInviteLink` and `parseInviteLink` in `src/domain/invite-link.ts`). Universal links can come later.
- **Errors:** `not_authenticated`, `invalid_input` (`field: 'idempotency_key'`), `room_not_found`, `room_ended`, `not_member`, `not_host`, `idempotency_conflict`
- **Replay:** the stored result holds the invite's id and expiry, never the token. A replay gives the same invite a fresh token (same row, same `expires_at`) and the token from the lost response stops working. If that invite is no longer live (replaced, expired, or its room ended), the key counts as new and goes through every check.

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
- **Note:** `recording_id` comes from a catalog search result. How search results become `recordings` rows depends on where search runs ([ARCHITECTURE.md, open decision 1](ARCHITECTURE.md#open-technical-decisions)).

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

#### `claim_playback_slot` / `release_playback_slot` (`sync` flag)

- **Caller:** member. The host always holds slot 1.
- **Input:** `room_id uuid`, `idempotency_key uuid`
- **Errors:** `feature_disabled` while `sync` is off, `provider_required`, `limit_exceeded` (15 slots)
- **Built as placeholders:** both functions exist, check sign-in, and fail with `feature_disabled` (`details.flag = 'sync'`).

### Matching

#### `override_track_match` (Added)

- **Caller:** host, from "Wrong version?".
- **Input:** `room_id uuid`, `recording_id uuid`, `provider`, `provider_track_id text`, `idempotency_key uuid`
- **Effect:** stores a `track_match_overrides` row with who changed it and when, and uses it for this room from then on.

### Account

#### q’d sign-in (Supabase Auth, client side)

Not an RPC: the app calls Supabase Auth through `src/services/auth.ts` only. Built for email/password and Google.

- `signInWithEmail({ email, password })`, `signUpWithEmail({ email, password }, { emailRedirectTo })`, `signOut()` (this device, `scope: 'local'`), `fetchSavedProfile(userId)` (reads the caller's own `profiles` row) and `onAuthChange(listener)`.
- `signInWithGoogle(redirectTo)` opens Google through Supabase OAuth (PKCE, `skipBrowserRedirect`) and exchanges the returned code. `exchangeAuthCode(code)` and `completeAuthRedirect(url)` finish any PKCE redirect; a code is exchanged once. `authRedirectUrl()` is the `/auth/callback` link; that route accepts `code`, or `error` / `error_code` / `error_description`, in the query or fragment (`parseAuthCallbackUrl` in `src/domain/auth.ts`).
- Each returns `{ ok: true, data } | { ok: false, code: AuthErrorCode }` and never throws. Sign-up's `data.needsEmailConfirmation` is true when the project makes new accounts confirm their email first.
- `AuthErrorCode` (`src/domain/auth.ts`): `invalid_credentials`, `email_not_confirmed`, `email_taken`, `weak_password`, `invalid_email`, `rate_limited`, `signups_disabled`, `method_unavailable`, `cancelled`, `link_expired`, `link_invalid`, `network`, `not_configured`, `unknown`.
- `onAuthChange` reports `{ event, user: { id, email, method, name } | null }`, never tokens, on the tick after Supabase's callback (a listener that calls Supabase inside the callback would wait on its auth lock).

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

### Versioning

- `v` increases only for a breaking change to an envelope. A client that sees an unknown `type` or a newer `v` ignores the payload and refetches.
- Add new event types instead of changing the meaning of old ones.

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
  getState(): Promise<PlaybackState>;
  disconnect(): Promise<void>;
}

type PlaybackCapabilities = {
  inAppAudio: boolean;          // Apple: true. Spotify: false (the Spotify app plays).
  backgroundPlayback: boolean;  // keeps playing with the screen locked
  requiresExternalApp: boolean; // Spotify: the Spotify app must be installed and active
  autoplay: boolean;            // provider can continue after the queue ends
  isMock: boolean;              // true only for mock adapters; the UI labels them
};

type ConnectionState =
  | { status: 'connected' }
  | { status: 'needs_authorization' }
  | { status: 'needs_subscription' }   // e.g. no Apple Music subscription or Spotify Premium
  | { status: 'app_not_installed' }    // Spotify
  | { status: 'error'; code: string };
```

**Rules every adapter follows** (the shared contract test suite checks these):

- No adapter claims a capability it doesn't have. Mocks set `isMock: true`.
- `prepare` never starts audio. `play` does.
- Errors surface as typed results or thrown `ProviderError`s with a `code`, never as silent no-ops.
- Nothing about tokens, emails or listening history reaches the logger unredacted.

## 6. Shared domain types

These are sketches. The domain types card writes them as Zod schemas in `src/domain`, and the TypeScript types are inferred from them.

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
