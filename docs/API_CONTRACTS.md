# API contracts

The contracts between the app, the database and the music providers: RPC functions, realtime events, provider adapters and shared types.

> **Status: proposed.** Nothing here is implemented yet. The RPC contracts card, the Supabase migrations card, the domain types card and the provider adapters card turn this into code. If the implementation needs a different shape, change this file in the same PR. Items marked **Added** aren't in the original plan's operation list. They're proposed because the product rules need them, and reviewers should confirm them.

Why it's shaped this way: [ARCHITECTURE.md § 4.10](ARCHITECTURE.md#410-client-vs-server-authority).

## 1. Conventions

- **RPC = a Postgres function**, called with `supabase.rpc('<name>', { ...args })`. Names and arguments are `snake_case`. TypeScript types use `camelCase` and are mapped at the edge in `src/services`.
- **Clients never insert into, update or delete from room tables directly.** RLS only lets members read. Every write goes through a function below.
- **Every function checks in this order:**
  1. signed in,
  2. the room exists and is in the right state,
  3. the caller is a member,
  4. the caller's role allows the action,
  5. capacity,
  6. idempotency,
  7. the operation's own rules.
- **Idempotency.** Every mutation takes `idempotency_key uuid`. The client creates one key per user intent (one tap) and reuses it on retries.
  - The server stores `(user_id, operation, idempotency_key)` with the successful result. A repeat call returns the stored result without repeating the effect.
  - The same key with different arguments fails with `idempotency_conflict`.
  - Only successful results are stored, so a rejected call (for example `already_in_queue`) can be retried with the same key.
  - Keys are kept for at least 24 hours.
- **Errors** carry a stable string `code` from [§ 2](#2-error-codes). The app maps codes to copy and never shows raw database messages.
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
| `feature_disabled` | Behind a feature flag that's off (`sync`, playlist import) |

## 3. RPC functions

### Rooms

#### `create_room`

- **Caller:** any signed-in user with a finished profile and a connected service (checked against `provider_connections`).
- **Input:** `name text`, `playback_provider 'apple_music' | 'spotify'`, `add_songs room_audience = 'everyone'`, `control room_audience = 'host'`, `idempotency_key uuid`. `room_audience` is `'everyone' | 'chosen' | 'host'`.
- **Effect:** creates a room in `aux` mode with the rules chosen on Start a room. Nobody is chosen yet. The caller becomes host and the first member. Generates a unique six-character code with an expiry.
- **Returns:** `{ room_id, code, code_expires_at }`
- **Errors:** `profile_incomplete`, `provider_required`
- **Note:** `mode` is always `aux`. A `sync` room needs the `sync` flag and fails with `feature_disabled`.

#### `join_room_by_code`

- **Caller:** any signed-in user.
- **Input:** `code text`, `idempotency_key uuid`. The code is case-insensitive, and the `QD-` prefix and spaces are optional.
- **Checks:** strict attempt limits per user and per IP address, applied before looking up the code.
- **Effect:** adds the caller as a member. If they're already a member, it succeeds without a change.
- **Returns:** `{ room_id }`
- **Errors:** `code_invalid`, `rate_limited`, `room_full`, `room_ended`, `profile_incomplete`

#### `update_room_rules` (Added)

- **Caller:** host. The host changes the room rules in Listeners.
- **Input:** `room_id uuid`, `add_songs room_audience`, `control room_audience`, `add_songs_chosen uuid[]`, `control_chosen uuid[]`, `idempotency_key uuid`. The chosen lists are user ids and are kept even while their rule isn't `chosen`.
- **Effect:** replaces the room's rules. Realtime tells the other phones to refetch, so their controls follow the new rules straight away.
- **Errors:** `not_host`, `not_member` (a chosen id isn't in the room)

#### `create_room_invite` (Added)

- **Caller:** host. QR invites need a token separate from the room code, and something has to create it.
- **Input:** `room_id uuid`, `idempotency_key uuid`
- **Effect:** creates a high-entropy (at least 128-bit, URL-safe) token with an expiry, which replaces any older one.
- **Returns:** `{ token, expires_at }`. The QR code encodes `qd://join?invite=<token>`, which opens the app's `/join` route. Universal links can come later.
- **Note:** the server keeps only a hash, so the host's phone keeps the token it got and reuses it while the app runs (DECISIONS 2026-11-25 · Invite / QR screen). The mock answers with deterministic `mock-…` tokens.

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
- **Proposed (Add a song card):** when nothing is playing, the new entry becomes the playing one and `queue_length` is 0, so the toast says "playing now". The mock store does this; the RPC contracts card confirms it.
- **Note:** `recording_id` comes from a catalog search result. How search results become `recordings` rows depends on where search runs ([ARCHITECTURE.md, open decision 1](ARCHITECTURE.md#open-technical-decisions)).

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

- **Caller:** any member the room's control rule allows. **Proposed (Add a song card):** also the member who added the entry, for the Undo on the "added" toast, while the entry is still queued. The RPC contracts card confirms or drops it.
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

### Matching

#### `override_track_match` (Added)

- **Caller:** host, from "Wrong version?".
- **Input:** `room_id uuid`, `recording_id uuid`, `provider`, `provider_track_id text`, `idempotency_key uuid`
- **Effect:** stores a `track_match_overrides` row with who changed it and when, and uses it for this room from then on.

### Account

#### `delete_account` (Edge Function)

Runs as an Edge Function, not a database function, because it needs the service role to delete the auth user and to revoke provider authorizations.

- **Caller:** the user, after signing in again recently.
- **Effect:** the steps in [PRODUCT_SPEC.md § 7](PRODUCT_SPEC.md#account-deletion). It ends hosted rooms through `end_room`, replaces attribution with "Deleted user", and retries until cleanup finishes (within 24 hours).

## 4. Realtime

### Channels

- One private channel per room: `room:<room_id>`.
- Realtime Authorization (RLS on `realtime.messages`) lets only room members join and listen.
- Clients never send room-state broadcasts. The database sends them, either from the RPC or from a trigger on the table it changed.

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
| Looks like | `QD-7K4F9X` (six characters after the prefix) | A long, URL-safe random string |
| Entropy | Low by design, so people can type it | At least 128 bits |
| Protection | Sign-in required, expiry, collision checks, attempt limits per user and per IP | Unguessable, expiry, the host can replace it |
| Stored as | The six characters, uppercase | A hash of the token |

The character set and the expiry length are open questions (see [PRODUCT_SPEC.md § 13](PRODUCT_SPEC.md#13-open-questions)).

## 8. Changing a contract

1. Change this file, the Zod schema in `src/domain` and the migration in the same PR.
2. A breaking change to a realtime envelope bumps its `v`.
3. A change to a product rule also gets an entry in [DECISIONS.md](DECISIONS.md).
