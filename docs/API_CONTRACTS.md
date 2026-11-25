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
| `provider_unavailable` | The music service couldn't answer: unreachable, timed out, rejected q’d's credentials or sent something unexpected. Includes `provider` and `reason`. Edge Functions only (catalog search). (Added) |
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

- **Caller:** any signed-in user.
- **Input:** `code text`, `idempotency_key uuid`. The code is case-insensitive, and the `QD-` prefix and spaces are optional.
- **Checks:** strict attempt limits per user and per IP address, applied before looking up the code.
- **Effect:** adds the caller as a member. If they're already a member, it succeeds without a change.
- **Returns:** `{ room_id }`
- **Errors:** `code_invalid`, `rate_limited`, `room_full`, `room_ended`, `profile_incomplete`
- **Mock (UI states card):** `src/features/room/roomCodes.ts` stands in for it on the Join screen, checking and joining in one call like the RPC (no read-only lookup first). A sample room's code joins it; `QD-FULL22` and `QD-ENDED2` give `room_full` and `room_ended`; wrong codes and `QD-STALE2` (expired) give `code_invalid`; five wrong codes in a row give `rate_limited` with `retryAfterSeconds` for 30 s. `QD-NETDWN` makes the call throw: the client's `network` state, not a server code. Same codes and names as the join-on-Home mock (`mockServer.ts`, `feat/create-join-screens`).

#### `update_room_rules` (Added)

- **Caller:** host. The host changes the room rules in Listeners.
- **Input:** `room_id uuid`, `add_songs room_audience`, `control room_audience`, `add_songs_chosen uuid[]`, `control_chosen uuid[]`, `idempotency_key uuid`. The chosen lists are user ids and are kept even while their rule isn't `chosen`.
- **Effect:** replaces the room's rules. Realtime tells the other phones to refetch, so their controls follow the new rules straight away.
- **Errors:** `not_host`, `not_member` (a chosen id isn't in the room)

#### `create_room_invite` (Added)

- **Caller:** host. QR invites need a token separate from the room code, and something has to create it.
- **Input:** `room_id uuid`, `idempotency_key uuid`
- **Effect:** creates a high-entropy (at least 128-bit, URL-safe) token with an expiry, which replaces any older one.
- **Returns:** `{ token, expires_at }`. The QR code encodes `qd://join?invite=<token>`. Universal links can come later.

#### `join_room_by_invite` (Added)

- **Caller:** any signed-in user who scanned a QR code.
- **Input:** `token text`, `idempotency_key uuid`
- **Effect, returns:** the same as `join_room_by_code`.
- **Errors:** `invite_invalid`, `rate_limited`, `room_full`, `room_ended`, `profile_incomplete`

#### `leave_room` (Added)

- **Caller:** a member who isn't the host. A host ends the room instead, because host transfer is post-demo.
- **Input:** `room_id uuid`, `idempotency_key uuid`

#### `end_room`

- **Caller:** host. `delete_account` also calls it.
- **Input:** `room_id uuid`, `idempotency_key uuid`
- **Effect:** marks the room ended, stops playback and expires its code and invites. History is kept for 90 days.

### Queue

#### `enqueue_recording`

- **Caller:** any member the room's add-songs rule allows (`not_allowed` otherwise). The default is everyone.
- **Input:** `room_id uuid`, `recording_id uuid`, `allow_duplicate boolean = false`, `idempotency_key uuid`
- **Effect:** inserts a queue entry at the end, with a position the server assigns while holding a lock on the room's queue.
- **Returns:** `{ entry_id, position, queue_length }`. The app uses `queue_length` for "Rain Down added · 8th in line".
- **Errors:** `already_in_queue` (unless `allow_duplicate`), `room_ended`, `not_member`. A song counts as already in the queue while it's queued or playing.
- **Confirmed (RPC contracts card):** when nothing is playing, the new entry becomes the playing one and `queue_length` is 0, so the toast says "playing now". The mock store does this.
- **Note:** `recording_id` comes from a catalog search result: `catalog-search` saves every result as a `recordings` row and returns its id ([§ Catalog](#catalog)).

#### `enqueue_batch` (post-demo, `playlist import` flag)

- **Caller:** any member the room's add-songs rule allows.
- **Input:** `room_id uuid`, `batch_id uuid`, `recording_ids uuid[]` (at most 50, in playlist order), `idempotency_key uuid`
- **Effect:** adds the entries in order under one `batch_id`. Only one import runs per room at a time.
- **Returns:** `{ batch_id, added, skipped }`
- **Errors:** `import_in_progress`, `limit_exceeded`, `feature_disabled`

#### `undo_batch` (post-demo, Added)

- **Caller:** host.
- **Input:** `room_id uuid`, `batch_id uuid`, `idempotency_key uuid`
- **Effect:** removes the batch's entries that haven't played yet.

#### `reorder_queue`

- **Caller:** any member the room's control rule allows. The default is the host only.
- **Input:** `room_id uuid`, `entry_id uuid`, `after_entry_id uuid | null` (`null` moves it to the top), `idempotency_key uuid`
- **Errors:** `entry_not_found`, `not_allowed`

#### `remove_queue_entry`

- **Caller:** any member the room's control rule allows. **Confirmed (RPC contracts card):** also the member who added the entry, for the Undo on the "added" toast, while the entry is still queued.
- **Input:** `room_id uuid`, `entry_id uuid`, `idempotency_key uuid`
- **Errors:** `entry_not_found`, `not_allowed`

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

**Built** (`supabase/migrations/20261125006000_override_track_match.sql`, "Wrong version?" card).

- **Caller:** the host only, from "Wrong version?". The control rule doesn't extend it: a listener it lets in still gets `not_host`.
- **Input:** `room_id uuid`, `recording_id uuid`, `provider music_provider`, `provider_track_id text`, `idempotency_key uuid`
- **Checks**, in §1's order: signed in, replay, arguments, the room (exists, not ended, locked), member, host. Then: `provider` is the service the room plays through; the recording has been in this room's queue (queued, playing, played or removed); the track is a saved `provider_tracks` row on that provider. It needn't be among the matcher's candidates: the host's choice always wins (DECISIONS 2026-11-24).
- **Effect:** appends a `track_match_overrides` row with the room, who picked it and when. Rows are never updated, so the table is the audit trail; the newest row for (room, recording, provider) wins, ties broken by the larger id. The override belongs to this room only: `track_matches`, which every room shares, doesn't change. Picking the version that's already the newest pick adds no row and sends no event. A new pick broadcasts `queue.changed` from inside the transaction (§4), so the room's phones refetch.
- **Returns:** `{ override_id, recording_id, provider, provider_track_id, created_at }`. A repeat of the current pick returns the existing row.
- **Errors:** `not_authenticated`, `invalid_input` (`details.field`: `idempotency_key`, `room_id`, `recording_id`, `provider` or `provider_track_id`; a `provider` other than the room's, a recording never queued in the room and a track q’d hasn't saved are `invalid_input` on that field), `room_not_found`, `room_ended`, `not_member`, `not_host`, `idempotency_conflict`. No new error code.
- **Reading it:** members read `track_match_overrides` through RLS (outsiders see nothing). The client takes the newest row per recording and service with `latestOverride` and turns it into the `TrackMatch` to play with `overriddenMatch` (`src/domain/match-override.ts`, §6); `availabilityOf` reads that as `playable`, with no warning.
- **Not swapped mid-song:** the app keeps playing the version a song started with. The pick plays from the next time the song comes up (DECISIONS 2026-11-25 · "Wrong version?" host override).
- **Depends on:** the chosen version must already be in `provider_tracks`. `catalog-search` saves Apple tracks; nothing saves Spotify tracks yet. The card that resolves mappings when playback needs them (ARCHITECTURE.md §7) has to save the candidates it offers before a Spotify override can succeed.

**Built (matching card):** the server stores what `matchRecording` in `src/domain/matching` decides. Its `match` is a `TrackMatch` (§6): `method: 'isrc' | 'score' | 'override'`, `confidence` 0–100, and `warning` set whenever the match isn't automatic. An unavailable recording has `providerTrackId: null` and `confidence: 0`.

**Built (availability and low-confidence states card):** clients never rematch. They read the stored `TrackMatch` through `availabilityOf` in `src/domain/availability.ts`, which returns `playable` (automatic or override), `uncertain` (`warning` set: plays with the warning shown), `unavailable` (`providerTrackId: null`: never plays) or `unknown` (nothing stored yet: the host's phone waits). `canPlayOnHostPhone` is true only for the first two. Proposed for the canonical search card: search results carry the matches already stored for each service (`CatalogResult.matches`, §5), so Add a song can warn before a song is queued.

### Account

#### `delete_account` (Edge Function)

Runs as an Edge Function, not a database function, because it needs the service role to delete the auth user and to revoke provider authorizations.

- **Placeholder built:** `supabase/functions/delete-account` accepts `POST` with a bearer token and answers `501 { "code": "feature_disabled" }` until the account-deletion card builds it. Other methods get `405 invalid_input`, and a request without a token gets `401 not_authenticated`.

- **Caller:** the user, after signing in again recently.
- **Effect:** the steps in [PRODUCT_SPEC.md § 7](PRODUCT_SPEC.md#account-deletion). It ends hosted rooms through `end_room`, replaces attribution with "Deleted user", and retries until cleanup finishes (within 24 hours).

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
    | 'queue.changed'         // add, batch add, reorder, remove, advance, version override
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
  matches?: Partial<Record<MusicProvider, TrackMatch>>;  // Added (availability card): stored matches, where resolved
  recordingId?: string;         // Added (canonical search card): the saved recording; mocks leave it out
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

// Added ("Wrong version?" card): where the picker finds a song's versions on
// the room's service. Only the labeled mock (src/providers/mock/versions.ts)
// exists; the live source searches the host's service in a later card.
interface VersionSource {
  versions(recordingId: string, provider: MusicProvider): Promise<VersionCandidates>;
}
type VersionCandidates = {
  recording: CanonicalRecording;
  candidates: ProviderTrack[];  // any version, in no order; matchRecording ranks them
  isMock: boolean;              // the screen labels mock versions
};

type ProviderErrorCode =
  | 'not_in_this_build'  // the real adapter isn't in this build yet
  | 'not_found'
  | 'unsupported_link'   // not an Apple Music or Spotify link q’d reads
  | 'wrong_provider'     // e.g. a Spotify track given to the Apple player
  | 'invalid_argument'   // e.g. a negative seek position
  | 'rate_limited'       // Added (canonical search card); ProviderError.retryAfterSeconds says when
  | 'provider_unavailable'; // Added (canonical search card): the service or q’d's server couldn't answer
```

**Built (provider adapters card)** in `src/providers`: the interfaces (`types.ts`), `ProviderError` (`errors.ts`), the share-link parser (`links.ts`), the mocks (`mock/`), and Apple Music and Spotify stubs (`apple/`, `spotify/`, `unavailable.ts`). Changes from the sketch above, marked here for review:

- **`getState` returns `PlayerState`,** not `PlaybackState`. The adapter knows one device's player; `PlaybackState` (§6) is the room's state the host reports, with a room and entry id the adapter doesn't have.
- **`ConnectionState` carries `isMock`,** and a connected state may carry an `accountLabel`. The error `code` is a `ProviderErrorCode`.
- **`ProviderTrack` gained `album`** (§6), because matching scores album context.
- **`getPlaylist` takes an optional cursor** for the next page.
- **Mocks claim no capability.** They play no audio, so every capability is `false` and `isMock` is `true`.
- **The Apple Music and Spotify adapters are stubs** until their cards land and are tested on an iPhone. `connect` returns `{ status: 'error', code: 'not_in_this_build', isMock: false }`, every other call rejects with that code, they claim no capability, and `disconnect` resolves (nothing to undo). The app still uses the mocks, because `mock` is the only data mode.
- The shared contract suite is `src/test/providerContract.ts`. `src/providers/contract.test.ts` runs it against the mocks and both stubs.

**Rules every adapter follows** (the shared contract test suite checks these):

- No adapter claims a capability it doesn't have. Mocks set `isMock: true`.
- `prepare` never starts audio. `play` does.
- Errors surface as typed results or thrown `ProviderError`s with a `code`, never as silent no-ops.
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

// Added ("Wrong version?" card), src/domain/match-override.ts.
type TrackMatchOverride = {
  id: string;
  roomId: string;
  recordingId: string;
  provider: MusicProvider;
  providerTrackId: string;        // 1–200 characters
  createdBy: string | null;       // null after the host deletes their account
  createdAt: string;
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
| Looks like | `QD-7K4F9X` (six characters after the prefix) | A long, URL-safe random string |
| Entropy | Low by design, so people can type it | At least 128 bits |
| Protection | Sign-in required, expiry, collision checks, attempt limits per user and per IP | Unguessable, expiry, the host can replace it |
| Stored as | The six characters, uppercase | A hash of the token |

- **Room code character set (decided 2026-11-24):** `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, 32 characters without `0`, `O`, `1` or `I`, so about 1.07 billion codes. Drawn from `gen_random_uuid()`'s random bytes.
- **Room code lifetime (decided 2026-11-24):** 24 hours from creation. The room keeps going after its code expires; only joining by code stops. A code is unique among rooms that haven't ended, and an ended room's code can be drawn again.
- The attempt limits are still open (see [PRODUCT_SPEC.md § 13](PRODUCT_SPEC.md#13-open-questions)).

## 8. Changing a contract

1. Change this file, the Zod schema in `src/domain` and the migration in the same PR.
2. A breaking change to a realtime envelope bumps its `v`.
3. A change to a product rule also gets an entry in [DECISIONS.md](DECISIONS.md).
