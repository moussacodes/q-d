# Decisions

Product and technical decisions that are not obvious from the code. Newest first.

## 2026-11-25 · Demo account reset

- **Operator scripts live in `supabase/scripts/`.** ARCHITECTURE.md named no place for them, and the runbook asked for the reset "as a script in `supabase/`". The reset script is plain CommonJS JavaScript with no dependencies (`fetch` only), so it runs with `node` on any supported Node, Windows included, without a build step. A `.d.ts` beside it types it for the tests.
- **The reset is a database function, not a series of queries from the script,** so it runs in one transaction under the room locks and reuses `end_room`'s steps. Both now go through `private.close_room()`; `end_room`'s contract and checks are unchanged.
- **Only the service role can run it, and only in the demo project.** Execute is granted to `service_role` alone, a call carrying a signed-in user is refused, and it needs the server flag `demo_reset`, which ships off. Someone turns it on by hand in the demo project once. Production never does, so a mix-up of keys can't reset anyone there.
- **It touches only the ids it's given:** 1 to 10 accounts, every one a real account, never an empty list. Rooms other people host stay as they are, even when a demo account is a member; the result counts those memberships so the operator can leave from the app.
- **What "clean" means.** The demo accounts' open rooms are ended like End room. The queues, import batches and memberships of every room they host are deleted, so Home has no leftovers and the code is free; the ended room rows stay. Their idempotency keys and failed join attempts are deleted, so a rehearsal's wrong codes can't lock the guest out on stage. **Profiles and music-service connections are kept:** the runbook needs both accounts signed in, onboarded and the host connected. The result counts accounts that aren't, and the runbook says what to do. A teammate should confirm that keeping profiles is the "known state" they want.
- **Dry run by default, at both ends.** The function's `apply` defaults to `false`, and the script sends `true` only with `--yes`. Both print or return counts only: no emails, ids, room codes, tokens or keys. Server error text isn't printed either, only q’d codes (a snake_case word) and HTTP statuses. The script never follows a redirect, so the key can't be forwarded to another host.
- **No idempotency key.** The reset is idempotent by itself: a second run finds nothing to do and broadcasts nothing.
- **The key lives in `.env.demo.local`,** which git ignores, never in the app's `.env` and never under an `EXPO_PUBLIC_` name. `.env.example` lists the names.
- **Not run against the real demo project yet.** It's tested on PGlite only. The first real run (dry run first) is part of the Dec 1 setup.

## 2026-11-25 · end_room

- **`end_room` returns `{ room_id, ended_at }`.** The contract listed no result. A replay returns the same values.
- **Ending a room expires its code** by moving `code_expires_at` back to the end time if it was later, and frees the code for new rooms. **It revokes the live invite,** so a scanned QR code answers `room_ended`.
- **Playback stops in the database** (`stopped`, reported by the host). The host's phone stops its player when it gets `room.ended`; the client card builds that.
- **History stays as it is.** Members keep reading the ended room, its members and its queue. The queue isn't rewritten (a playing entry stays `playing`), and the 90-day cleanup is a later card.
- **No finished profile is needed,** because `delete_account` calls it for a user who's leaving.

## 2026-11-25 · QR invitations

- **A QR invite works for 24 hours,** like a room code, counted from when the host creates it. Each new invite revokes the older one, as the contract says, so a room has one live invite. **A teammate should confirm the length.**
- **The token is 32 random bytes** (two v4 UUIDs, 244 random bits) written as 43 unpadded base64url characters. Only its SHA-256 hash is stored. A salt isn't needed: the token itself can't be guessed.
- **The database never holds the token, not even for idempotency.** `create_room_invite` stores the invite's id and expiry under the key instead. A replay (the app retried because the response was lost) gives the same invite a fresh token: same row, same expiry. The token from the lost response stops working, which is harmless because nobody received it. If that invite isn't live any more, the key counts as new.
- **Unknown tokens count toward the attempt limits** like wrong codes, with their own count (5 per user, 20 per IP address in 10 minutes), so a lockout on one doesn't block the other. Malformed, revoked and expired tokens answer `invite_invalid` without counting: they aren't guesses.
- **A real token of an ended room answers `room_ended`,** not `invite_invalid`. The token proves the caller was invited, so telling them the room is over gives nothing away. (Ending the room also revokes the invite.)
- **The link helper is pure** (`src/domain/invite-link.ts`): `buildInviteLink(token)` gives `qd://join?invite=<token>` and `parseInviteLink(url)` reads a token back, or null. It never accepts a room code as a token.
- **Not built here:** the QR on the Invite sheet, the screen that handles `qd://join?invite=…`, and the feature hook that calls these RPCs. Those belong to the Invite/QR screen card.

## 2026-11-25 · join_room_by_code

- **Attempt limits: 5 wrong codes per user and 20 per IP address in any 10 minutes.** The next try fails with `rate_limited` and `retry_after_seconds` until the oldest failure is ten minutes old. With a billion codes, five guesses per ten minutes can't find a room. This answers the last part of PRODUCT_SPEC.md § 13 "Room codes"; **a teammate should confirm the numbers.**
- **The limits are checked before the code is looked up,** so a locked-out caller can't join even with the right code, and a locked-out call isn't counted again.
- **A successful join doesn't reset the count.** Otherwise anyone could clear it between guesses with their own room's code. The count resets only as failures age out of the window.
- **Only wrong codes count.** Input that can't be a code (wrong length, or a character outside the code alphabet such as `0`, `O`, `1` or `I`) answers `code_invalid` too, but isn't counted: it can't match a room, so it tells nobody anything, and a typo shouldn't use up a guess. Look-alikes aren't mapped to other characters, because none of them is ever in a code.
- **Input is forgiving:** case doesn't matter, and spaces, dashes and the `QD-` prefix are optional. A code can itself start with `QD`, so the prefix is dropped only from eight characters.
- **A wrong guess is kept although the call fails.** A raised error rolls everything back, the record of the guess included. So `code_invalid` is answered by `private.error_response()`: the function returns normally, the failed attempt commits, and PostgREST answers HTTP 400 with the same body a raised error has (`message: 'code_invalid'`, `hint: 'qd'`). supabase-js reports it as `error` like any other. This is the one exception to "RPCs raise their errors", and only for errors whose side effect must survive. PostgREST commits every transaction that doesn't fail, whatever `response.status` says.
- **Failed attempts live in `private.join_attempts`,** which no API role can read or write. It never holds the code that was tried, and holds the IP address only as a SHA-256 hash. `private.purge_join_attempts()` deletes rows older than a day; a scheduled job should call it.
- **The IP address is the first `X-Forwarded-For` entry** PostgREST passes in `request.headers`. A client can put its own entries in front, so the per-user limit is the one that can't be dodged. **Check on a real Supabase project** which entry the gateway sets.
- **An ended room's code is a wrong code,** not `room_ended`: ending a room frees its code (2026-11-24), so the code no longer names that room, and saying otherwise would tell a guesser which codes were in use. `room_ended` still comes back if the room ends between the lookup and the join.
- **Someone already in the room succeeds without a change,** the host included, and no broadcast is sent. A new member makes the RPC broadcast `members.changed`.
- **`room_full` is checked by the RPC** under the room lock, so it comes back as a q’d error (`hint: 'qd'`). The trigger on `room_members` still backs it up.

## 2026-11-25 · Queue concurrency and idempotency tests

- **PGlite can't run two transactions at once,** so "several people add at once" is tested as bursts of requests fired together, which PGlite runs one whole transaction at a time in arrival order. The tests check what must hold in any order: one playing entry, queued positions `1..n`, each success applied once, replays returning the first result, and the same key with other arguments failing with `idempotency_conflict`.
- **The lock itself is checked structurally.** A test reads each queue RPC's source and fails if it touches the queue before `private.lock_room()`, and another checks that `lock_room` holds the room row for the rest of the transaction. True parallel blocking needs the same suite on the Supabase local stack (Mac, `supabase start`).
- **The random burst is seeded,** so a failure can be replayed exactly.

## 2026-11-25 · reorder_queue and remove_queue_entry

- **The control rule decides, not "host only".** The Trello card says only the host may reorder or remove. The newer decisions win: the control rule (Everyone / Chosen / Only you, 2026-11-20) governs both, and its default is still the host only. The person who added an entry may remove it while it's queued (the Undo, 2026-11-24).
- **Undo ends when the song starts.** Removing a playing entry fails with `stale_state` for everyone, the host included. Skip is `advance_queue`, so a stale Remove can't skip a song.
- **`stale_state` means "you saw an old queue".** Reordering or removing an entry that's playing now, or moving after an entry that was removed or played since, is `stale_state` (refetch and retry). An entry that's gone is `entry_not_found`, as the contract says.
- **"After the playing song" is the top.** If the entry the user dropped below has started playing, the move goes to the top, which is where the user meant.
- **A no-op move succeeds quietly.** Moving an entry to where it already is returns its position and sends no broadcast.
- **Removed entries stay as rows** with status `removed`, so history and attribution survive; positions of the rest close up.
- **Returns.** The contract had none: `reorder_queue` returns `{ entry_id, position, queue_length }` and `remove_queue_entry` returns `{ entry_id, queue_length }`.

## 2026-11-25 · enqueue_batch

- **Server-side feature flags live in `private.feature_flags`.** `enqueue_batch` and `undo_batch` check `playlist_import`, which is off, and fail with `feature_disabled`. Clients can't read or change the table. The app-side flag (ARCHITECTURE.md § 8) is still the Env validation card's job; the database refuses even if a modified client calls the RPC.
- **The import preview creates the batch, not `enqueue_batch`.** The contract passes a `batch_id`, so the batch already exists: the post-demo import card's preview creates it in `previewing` with the playlist's provider and name. `enqueue_batch` adds the confirmed songs, then marks it `done`. Only the person who created the batch can import it.
- **A batch skips songs already in the queue.** It can't ask "Already in queue" for each song, so songs already queued or playing, and repeats inside the playlist, are skipped and counted in `skipped`. **A teammate should confirm**; the alternative is adding duplicates silently.
- **A batch already imported is `stale_state`,** with `details.status`. A retry with the same key still gets the stored result.
- **One broadcast per batch,** not one per song.
- **`undo_batch` stays host-only,** as the contract says. Undo takes back only songs still waiting; the playing one and played ones stay.
- **No app entry point yet.** Nothing in the app calls these until the playlist-import card, so nothing is exposed for the demo.

## 2026-11-25 · enqueue_recording

- **Queue positions are dense integers** (ARCHITECTURE.md open decision 3). Queued entries are `1..n` in play order and the playing entry is `0`, so `position` is also the place in line the toast shows. Queues are short (tens of songs), so renumbering on a reorder or removal is cheap, and it's easier to test and reason about than gaps or fractional ranks. A unique index on queued positions per room makes a repeated position impossible.
- **The room lock decides the order.** `enqueue_recording` locks the room row before reading the last position, so additions made at the same moment are placed one after another in the order they took the lock.
- **"Already in queue" says which kind.** `already_in_queue` carries `details.status` (`queued` or `playing`), so the app can ask "Already in queue. Add it again?" or "Playing now. Add it again?" (2026-11-19 · Search / add-song overlay) without a second request.
- **"Nothing playing" starts the song.** The contract's rule is applied literally: if no entry is playing, the new one plays at once (position 0, `queue_length` 0). With today's RPCs a queue never has waiting songs while nothing plays, so this only happens in an empty room.
- **An unknown `recording_id` is `invalid_input`** (`details.field = 'recording_id'`), like a missing one. Search results always come from `recordings`, so this means a client bug, not a user situation.
- **No profile check.** Members already finished onboarding to join, so `enqueue_recording` doesn't repeat `profile_incomplete`.

## 2026-11-24 · create_room

- **Room codes leave out look-alike characters.** Codes use `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (no `0`, `O`, `1` or `I`), so a code read aloud or typed from a screen can't be misread. Six characters still give about a billion codes. This answers part of PRODUCT_SPEC.md § 13; **a teammate should confirm it**.
- **A room code works for 24 hours.** Long enough for an evening, short enough that old codes stop working. The room itself keeps going; only joining by code stops. A way to refresh the code can come with the join card if hosts need it. **A teammate should confirm the length.**
- **A collision draws again,** up to ten times, then fails with an internal error. With a billion codes that should never happen.
- **`create_room` takes an optional `mode`** (default `aux`). `sync` fails with `feature_disabled`, as the contract says, without needing a flag table yet.
- **The name is trimmed** and must be 1–40 characters (`invalid_input` otherwise).
- **One host may run several live rooms.** Nothing in the product rules limits it.

## 2026-11-24 · Row level security

- **Clients only read.** Direct inserts, updates and deletes on room, queue, playback, catalog and system tables fail with permission denied for everyone, the host included. Play, pause, skip, reorder and remove go through RPCs that check the control rule; by default only the host passes it.
- **Three things a user writes directly:** their own profile's onboarding fields (`display_name`, `color`, `adult_confirmed_at`), their own `provider_connections` rows, and their own `blocks`. Onboarding and Settings need these, and none of them is shared room state.
- **`create_room` trusts `provider_connections`.** The server can't verify a connection, because provider tokens stay on the device. A modified client could claim one, but it still couldn't play anything without a real provider account.
- **Members see each other's profiles,** so Listeners and the queue can show names and colors. Outsiders see only their own.
- **Only the host reads the invite row.** It holds a hash, never the token.
- **`anon` gets nothing,** not even empty results: every table read fails with permission denied.
- **Guard tests** fail when a new table keeps Supabase's default grants, so the next migrations can't expose a table by accident.

## 2026-11-24 · RPC contracts

- **The proposals are confirmed.** Every operation marked Added in API_CONTRACTS.md (`update_room_rules`, `create_room_invite`, `join_room_by_invite`, `leave_room`, `undo_batch`, `report_playback_state`, `request_playback`, `advance_queue`, `override_track_match`) stays. Two smaller proposals are confirmed too: adding to an empty room starts that song, and the person who added a queued entry may remove it (the Undo on the "added" toast).
- **One error transport.** RPCs raise SQLSTATE `P0001` with the code as the message, extra fields as JSON in the detail, and the hint `qd`. Edge Functions return `{ "code": … }`. An unknown code can't be raised, and a test keeps the code list and API_CONTRACTS.md § 2 identical.
- **New code `invalid_input`** for a missing or out-of-range argument (a blank room name, no idempotency key). The contract had no code for it.
- **A replay is answered before the other checks,** right after sign-in. Otherwise retrying `end_room` after it succeeded would fail with `room_ended`. A new key goes through every check.
- **The RPC sends the broadcast** (open decision 2), from inside its transaction with `realtime.send()`, so a rolled-back change announces nothing.
- **Shared checks live in a `private` schema** the API doesn't expose. Nothing there is executable by `anon` or `authenticated`; public RPCs are `security definer` with a pinned `search_path`. A test fails if any q’d function lacks a pinned `search_path` or is executable by `anon`.
- **`claim_playback_slot` and `release_playback_slot` exist** and fail with `feature_disabled` while `sync` is off. The `delete-account` Edge Function exists as a placeholder that answers `feature_disabled`.

## 2026-11-24 · Initial Supabase migrations

- **The schema follows ARCHITECTURE.md §5 names**: `recordings`, `provider_tracks` and `track_matches`, not "canonical recordings" or "mappings". `track_matches` and `track_match_overrides` point at a provider track by `(provider, provider_track_id)`, the provider's own id, like the `TrackMatch` domain type.
- **Row level security is on for every table from the first migration,** with no policies. Everything is denied until the RLS migration opens reads, so there's never a window where Supabase's default grants expose a table.
- **No credentials in Postgres.** `provider_connections` holds the provider, when it was connected or last checked, and a storefront. A test fails if any public column is named like a token, secret, password or credential, except the invite's `token_hash`.
- **Every auth user gets an empty profile row** from a trigger on `auth.users`. The profile is complete when `display_name`, `color` and `adult_confirmed_at` are set. `color` has no default, because the first swatch belongs to the design tokens, not the database.
- **The 15-person cap is a trigger on `room_members`,** under a lock on the room row, so it holds however a member is added. It raises `room_full`.
- **A room code is unique among rooms that haven't ended.** Ending a room frees its code.
- **The queue is batch-ready.** `queue_entries.batch_id` points at `playlist_import_batches`, which allows one running import per room. `blocks`, `reports` and `analytics_events` are placeholders for the beta.
- **Idempotency keys get their own table** (`idempotency_keys`) instead of a column on each table, so every RPC uses the same machinery.
- **Database tests run on PGlite inside Jest** (ARCHITECTURE.md § Database tests), because Windows has no Docker or Supabase CLI. A test-only shim provides Supabase's roles, `auth` and `realtime`. The same tests should also run against `supabase start` on the Mac.

## 2026-11-20 · Room screen: expanded cover only

- **A playing song always shows the expanded cover (Figma 3.2).** The resize button is gone, so the smaller-cover layout (3.1) no longer appears while a song plays. The cover is as big as it can be while the song info and playback controls still fit above the Up next bar. The full queue is below them.
- **Who's in the room is in the Up next sheet.** The expanded layout has no people strip. The Up next bar opens the sheet that shows it.
- **An empty room keeps the 3.1 layout.** With nothing playing there's no cover to expand, so the room shows the empty cover, the people strip and Add a song.

## 2026-11-20 · Room rules the host chooses

- **The room rules are choices now.** This replaces "Demo room rules are fixed" (2026-11-19 · Screen shells). Baron asked for it. Start a room offers **Everyone**, **Chosen** or **Only you** for two rules: Add songs, and Play, skip, reorder, remove. The defaults are the old fixed rules, so a host who changes nothing gets the same room.
- **One rule covers play, pause, skip, reorder and remove.** Baron asked to keep them together rather than split them.
- **Chosen people are picked in Listeners.** Nobody has joined when the room starts, so Start a room only says where to pick them. In Listeners the host changes the rules and, for each rule set to Chosen, taps an **Adds songs** or **Controls** chip next to a person. Each rule has its own list. Switching a rule away from Chosen keeps the list, so switching back restores it.
- **Everyone else sees the rules as text** in Listeners ("Host only", "Chosen people (incl. you)"). Controls they can't use are disabled, and a disabled Add a song says why.
- **The mini player follows the control rule** too, so a chosen listener can pause from Home.
- **Contracts.** `create_room` takes the two rules, and `update_room_rules` is added. The queue and playback operations check the rules and fail with `not_allowed`. `request_playback` is added, because only the host's phone plays in aux, so a listener's play or pause has to reach it. All of these are proposals for the RPC contracts card to confirm.
- **Mock mode.** The room store holds the rules with the queue, and `src/domain/room-rules.ts` decides who's allowed. The listener preview (`?view=listener`) looks at the room as its first listener, Maya, so choosing Maya in Listeners shows what a chosen listener gets.
- **Sample data fix.** "Late Drive Home" and "Study Hall" marked you as their host, although Priya and Theo host them, so you'd have had full control there. Their named hosts are the hosts now, and a test checks it.
- **Still post-demo:** "Ask before people join" and automatic host transfer. `docs/PLAN.md` §2 still lists chosen people and guest skip as post-demo, so the team updates it.

## 2026-11-19 · Search / add-song overlay

- **Adding a song puts it in the queue.** Tapping + calls the mock `enqueue_recording`. The song goes to the end of the queue, labeled "by" the person who added it, and the toast says where it landed ("Rain Down added · 5th in line"). Everyone can add, with or without a music service.
- **Already in queue asks first** (PRODUCT_SPEC.md §5). A song that's queued or playing keeps its chip ("In queue" or "Playing") and its + button. Tapping + asks "Already in queue. Add it again?" or "Playing now. Add it again?". "Add again" adds a second copy. Figma has no frame for this, so the question appears under the song.
- **Undo takes your song back** while it's still waiting in the queue. Once it's playing, Undo disappears. The contract had `remove_queue_entry` as host-only, so `API_CONTRACTS.md` now proposes letting the person who added an entry remove it for Undo. **Needs a teammate's confirmation** in the RPC contracts card.
- **Songs that aren't on the host's service can be added.** The shells disabled + for them, but PRODUCT_SPEC.md §6 expects such songs in the queue: the host is asked to switch or skip when one comes up. The result still says "Not on Spotify", and the queue row says the host can skip it. This is what demo beat 5 needs.
- **Adding to an empty room starts it.** With nothing playing, the new song plays at once and the toast says "playing now". `API_CONTRACTS.md` marks this as proposed.
- **The 4.2 preview stays separate.** Adding a song there starts the preview's room, not the sample room.

## 2026-11-19 · Room screen: default, expanded and queue states

- **The queue changes now.** In mock mode a room store (`src/features/room/roomStore.ts`) stands in for the room's queue rows. Its actions follow the RPC contracts: `reorder_queue` (move after an entry, or to the top), `remove_queue_entry` and `advance_queue`. Screens read the room through `useRoom` and don't import sample data, so the room screen, Up next and Add a song came off the lint exception list.
- **Skip works.** The host's Skip button, and Skip on "Not on Spotify", call `advance_queue` with the entry that's playing. A second Skip for the same song does nothing (`stale_state`), so a double tap can't skip two songs.
- **The host reorders and removes by tapping a song.** The song opens Up, Down and Remove. That stands in for dragging the grip until a gesture library is chosen (ARCHITECTURE.md, open decision 4). Listeners can't open a song, and their Skip stays disabled.
- **Songs move on by themselves.** The host's player holds one song. When it ends, the room advances and the next song plays from the start. Only the room's first song opens 1:40 in, like the Figma frames.
- **Queue entries have their own ids,** separate from the song's, so the same song can be queued twice (Add a song asks first, PRODUCT_SPEC.md §5).
- **"Not on <service>" follows the song,** not the `?view=` preview. The room shows it whenever the now-playing song isn't on the service the room plays through, and the queue note appears only for that service. The switch button still does nothing; that's the provider-switching card.
- **Up next shows the real count and length,** for example "6 songs · 21 min" instead of Figma's fixed "25 min".
- **The room you started keeps its name and service.** The room screen reads the room from the session, which fixes the known gap in "Provider-optional flow".
- **Previews.** The 4.2 and 4.3 previews get their own queue, so trying them never changes the sample room. The listener and Apple Music previews share the sample room's queue. Sheets opened from a preview keep it.
- **Mock only.** The store lives on one device, so a second phone doesn't see these changes. Shared queues come with the Supabase and Realtime cards.

## 2026-11-19 · Dynamic color modes

- **The palette follows the provider rule** (plan.md §3). Apple Music songs take their colors from the artwork background color Apple supplies. Spotify songs use a provider-neutral palette of warm greys, because Spotify supplies no color q’d may use. Nothing reads artwork pixels: covers are never analyzed, cropped or overlaid to pick colors.
- **One color becomes a full palette** (`src/design/artworkPalette.ts`). The cover hue sets the accent, on-accent and three glows, using the lightness and saturation steps of the Figma "Son of Spergy" mode. A cover with that hue reproduces the mode. Grey covers give a grey palette, like Figma "Rebel".
- **The Figma modes' second and third glows** come from other colors in their artwork, which Apple doesn't supply. Here those glows follow the main hue, shifted slightly.
- **The service the room plays through decides the palette**, not where the song was found. The sample host room plays through Spotify, so it now shows the neutral palette. `/dev` has a "plays through Apple Music" room to show artwork colors. Hosting through Apple Music (Start a room) uses them too.
- **Sample data carries Apple artwork colors** instead of ready-made palettes. Those values were picked to match the Figma modes. The gallery's Figma modes (`previewPalettes`) stay as reference.
- **Fix:** each backdrop now has its own SVG gradient ids. On web, stacked screens shared ids, so a screen opened over another showed no glow.

## 2026-11-19 · Three-step onboarding

- **The three steps follow the Figma page.** Step 1 collects display name, color and 18+ on one screen. Step 2 is music services (optional, with Skip). Step 3 is start or join. The card's "display name", "color" and "18+" items are the three fields of step 1, not three screens.
- **Required on step 1:** a display name that isn't blank (trimmed, up to 30 characters) and the 18+ confirmation. Color defaults to the first swatch.
- **Name suggestion.** Apple and Google suggest the account's name. Email sign-ups start blank.
- **The profile is saved when step 1 continues.** Home's greeting, the avatar and Settings use it. Settings → Account edits the display name, and an empty name isn't saved.
- **Back on step 1 cancels sign-up** and returns to Welcome. Otherwise Back would land on a signed-out screen that redirects straight back.
- **Settings shows the sign-in method** (Apple, Google or Email).
- **Not done here:** saving the profile to Supabase `profiles` under RLS. That needs the Supabase cards.

## 2026-11-19 · Provider-optional flow

- **Music services are separate from q’d sign-in.** Connections live in their own state (`features/connections`). Signing in never connects a service, and connecting one never changes the sign-in state.
- **Connections belong to the account.** A new account starts with none. A returning mock account already has Spotify (mock), the way a real returning user would have a saved connection. Signing out clears them.
- **Only hosting needs a service** (plan.md §2). Start a room shows "Connect a music service to host" with a Connect button per service, and Start room stays disabled until one is connected. Join, the room and Add a song never ask for one. Claiming a sync slot is post-demo, so it isn't built.
- **"Play rooms through"** chooses between connected services and is hidden with none connected. With both connected, tapping it switches.
- **Known gap:** the room screen still reads its service from sample data. The room screen card moves it to the session's room, which already records the chosen service.

## 2026-11-19 · Auth and onboarding navigation

- **Three sign-in states.** Signed out, onboarding (signed in, profile not finished) and ready. They live in the mock session for now; Supabase Auth and the profile row decide them once the auth cards land.
- **Route guards, not redirects in screens.** `app/_layout.tsx` puts every screen in one `Stack.Protected` group per state. Opening a screen from another state's group lands on that state's first screen: Welcome, onboarding step 1 or Home. Welcome stays at `/`.
- **Mock sign-in.** "Continue with Apple" or "Google" on Welcome, and "Create account", start a new account and go to onboarding. Sign in (form, Apple or Google) is a returning user and goes to Home. Real auth decides new versus returning.
- **Step 3 finishes onboarding.** "Start a room" and "Join with a code" open that screen with Home underneath, so Back goes Home. "I’ll do this later" goes Home.
- **Sign out** leaves the room and returns to Welcome.
- **Every launch starts signed out** in mock mode. Nothing is persisted.
- **`/dev` switches state.** Opening a screen from the screen index switches the mock session to the state that screen needs, so every screen can still be reviewed.

## 2026-11-19 · Mock-data development mode

- **One switch, `EXPO_PUBLIC_DATA_MODE`.** `mock` is the only mode that exists until Supabase and the real providers land, so any other value falls back to `mock` with a warning (`src/services/dataMode.ts`).
- **Mock is always labeled.** In mock mode a strip under the status bar reads "Mock data · nothing here is live". Mock music-service connections say "Mock connection · no Spotify account used" instead of an account name. Mock data is never shown as a live integration.
- **Mock adapters implement the plan's interfaces.** `src/providers/types.ts` holds `CatalogAdapter` and `PlaybackAdapter` from plan.md §3, trimmed to what the mocks need. `ConnectionState.isMock` lets the UI tell a mock connection from a real one. The provider-adapter card extends these instead of starting over.
- **The mock player keeps real time.** Rooms open at 1:40 into the song, like the Figma frames. Progress advances, the host can pause and play, and when a song ends the next queued song plays. Home's mini player and the room share one player per room, so they always agree.
- **Mock search is deterministic.** Every word of the query has to match the title, artist or album, ignoring case, accents and punctuation. Results keep a fixed order.
- **Runs on Windows.** `npm run web` (or `npx expo start` for Expo Go) works with no Mac, backend or provider accounts.
- **Sample data moved to `src/providers/mock/data.ts`.** It's the mock mode's data, so it can't live in `src/test` (production code must not import tests, ARCHITECTURE.md §4). `src/test/fixtures/mock-data.ts` re-exports it for tests and for the screens still on the lint exception list. `RoomParts` and `MockSession` came off that list; each screen card removes its screen as it moves to a feature hook.

## 2026-11-19 · Quality gates

- **CI runs on GitHub Actions** for every pull request and every push to `main`. It installs, generates the typed-route declarations, then runs the typecheck, lint, format check, Jest and Expo Doctor. It uses Node 22.13, the `engines` minimum, so newer-Node features can't slip in.
- **A Git pre-push hook runs the whole CI job before every push** (`.githooks/pre-push`, turned on by the `prepare` script during `npm ci`), so a failing push is caught before it reaches GitHub. A plain Git hook needs no extra dependency, and it runs for both people and both agents. `prepare` ignores errors, so installs without a `.git` folder (EAS builds, for example) still work.
- **There's no pre-commit hook.** Running the full check on every commit was slow enough to discourage small commits. It also checked the working tree rather than the commit, and the pre-push hook runs the same checks before anything leaves the machine.
- **No CD yet.** Delivery means EAS builds and TestFlight. Those need the EAS project (`eas init`, which also sets `owner`), the EAS build profiles card, an `EXPO_TOKEN` secret and Apple credentials. Automated builds get added after the EAS build profiles card.
- **Prettier formats code, not Markdown.** Its table padding would rewrite every row of a table whenever one cell changes.
- **LF line endings everywhere.** `.gitattributes` sets `eol=lf`, so Windows checkouts (where `core.autocrlf` is on) match the Mac and CI byte for byte.
- **The first Prettier pass touched existing screens and components.** It changed formatting only. The rendered text is unchanged.
- **ESLint enforces the import rules** in ARCHITECTURE.md §4. Screens that still read `src/test` fixtures are listed as exceptions by file name, so new imports from `src/test` fail.
- **`expo-asset` is a direct dependency.** `expo-font` loads fonts through it without declaring it, and Jest couldn't resolve the copy nested under `expo/`.
- **`test-renderer` is pinned to 1.3.0,** the version `jest-expo` uses. React Native Testing Library and jest-expo then share one renderer.
- **`tsconfig.json` sets `"types": ["jest"]`.** TypeScript 6 no longer loads every installed `@types/*` package by default.
- **Maestro targets a development build** (`app.qd.mobile`), not Expo Go, and isn't in CI. It runs on the Mac once the EAS development profile exists.

## 2026-11-19 · The plan joins the repository

- **The team's plan is now `docs/PLAN.md`.** It was a local, untracked `plan.md`. It's committed so the team can read and edit it from any machine. This replaces the rule in the next entry that the plan stays outside git. The other `docs/` files still carry its rules, and comments that cite "plan.md §2" mean this file.

## 2026-11-19 · Project docs

- **`docs/` is the source of truth in the repository.** `PRODUCT_SPEC.md`, `ARCHITECTURE.md`, `API_CONTRACTS.md` and `PROVIDER_FEASIBILITY.md` carry the rules from the team's plan. The plan itself (`plan.md`) stays outside git. When a rule changes, update the doc and add an entry here.
- **`CLAUDE.md` imports `AGENTS.md`.** Both agents read one file, so their rules can't drift apart. `AGENTS.md` points to `docs/` instead of repeating requirements.
- **`ARCHITECTURE.md` marks each part Built or Planned.** Most of the architecture isn't built yet. The PR that builds a part updates its status.
- **The API contracts are proposals.** Seven operations in `API_CONTRACTS.md` aren't in the plan's operation list, and the product rules need them:
  - `create_room_invite` and `join_room_by_invite` for QR invites,
  - `leave_room`,
  - `undo_batch` for the post-demo "undo the import",
  - `report_playback_state` and `advance_queue` so listeners can see what the host plays,
  - `override_track_match` for "Wrong version?".

  The RPC contracts card confirms or changes them.
- **Realtime events carry no personal or song data.** They only say what changed, and clients refetch from Postgres.
- **Wrong and expired room codes return the same error** (`code_invalid`), so nobody can probe which codes exist.
- **Supabase replaces the pitch deck's first-draft architecture.** The deck showed an API gateway, a WebSocket gateway, Redis and separate services.
- **Import-rule exception.** The screen shells import `src/test/fixtures/mock-data.ts` directly. That's temporary. The mock-data development mode and the real data cards replace it, and new code shouldn't add more such imports.
- **Spotify facts were re-checked on 2026-11-19.** Development mode requires Premium for the app owner, allows one client ID and five users, and reduces the endpoint set. Track ISRCs (`external_ids`) are still returned, because March 2026 reversed their removal. Details and sources are in `PROVIDER_FEASIBILITY.md`.

## 2026-11-19 · Screen shells

The Figma page `20 · Mobile` is an initial direction. Where it conflicts with plan.md, the plan wins (team decision, 2026-11-19). The shells keep the Figma layout and change only what's below.

- **Aux mode, not sync.** The Figma room screens assume everyone listens on their own service. The demo is aux: only the host's phone plays.
  - Removed **Resync**. The room strip now says "N in the room" instead of "5 of 6 in sync".
  - Listeners see the host chip, and the host sees an **Invite** chip.
  - Copy now says the host's phone plays the music, and that guests don't need a music service: Welcome, onboarding step 2, Join, Invite, empty room and Add a song.
  - **4.3 "Not on your service"** is shown from the host's side. The song isn't on the service the host's phone plays through, so the host can skip it or switch services for the next song (plan.md §2). A listener no longer "sits it out".
  - Settings no longer has "When a song isn't on your service" (Play via YouTube Music / Sit it out).
- **Room codes have six characters** (QD-7K4F9X), not four. The Join screen has six code boxes.
- **Demo room rules are fixed.** *Replaced on 2026-11-20 by "Room rules the host chooses".*
  - Everyone can add songs. Only the host can play, skip, reorder or remove.
  - Start a room and Listeners show these rules as text. "Chosen people", "Ask before people join" and per-person skip chips are post-demo, so they're absent.
  - Start a room gained a "Plays on this phone · Through Spotify" row, because hosting needs a connected service.
- **Only Apple Music and Spotify appear.** YouTube Music and the "Soon: Tidal · Deezer · Amazon Music" card are removed everywhere. Add a song filters by All / Spotify / Apple Music, and each result says whether it's on the host's service.
- **18+ confirmation** was added to onboarding step 1, which plan.md §2 requires but Figma doesn't show.
- **Welcome headline** is the product line "Different apps. One aux.". "Listen together, on any service." overstated support.
- **Create account** reuses the Sign in layout. There's no Figma frame for it.
- **QR code** is a placeholder until the QR-invitation card, which uses a separate high-entropy token.
- **Sheets** (Up next, Add a song, Invite, Listeners) are modal routes under `/room/[code]/…`, so each can be opened and reviewed directly.
- **`/dev`** lists every screen and state, numbered like the Figma page. The Welcome screen links to it in development builds only.

## 2026-11-19 · Design tokens and core components

- **Fonts: Geist and Geist Mono.** The Figma page `20 · Mobile` uses Geist and Geist Mono. Both are free under the SIL Open Font License and ship through `@expo-google-fonts/geist` and `@expo-google-fonts/geist-mono`. So the iOS-system-font fallback in plan.md isn't needed. Each weight is loaded as its own font family (for example `Geist-SemiBold`), so iOS and Android render the same file.
- **Only `20 · Mobile` is a source.** Colors, type styles, radii and spacing come from that page's variables and components: `src/design`.
- **Letter spacing.** Figma gives letter spacing as a percentage of font size. React Native needs points, so `typography.ts` converts it, for example −3% at 36 pt becomes −1.08.
- **Now playing colors.**
  - Accent, on-accent and the three backdrop glows are per-song colors. In Figma they're variable modes (Idle, Son of Spergy, French Exit, Never Enough, Rebel). In code they're a `NowPlayingPalette` held by `ThemeProvider`.
  - The Figma modes are kept in `previewPalettes` only as sample data. The app will compute palettes from artwork.
  - `accent-soft` is the accent at 0x29 alpha. That pattern is confirmed for the Son of Spergy mode, and the other modes use the same rule.
- **Backdrop glow.** Figma draws three circles with a 65 pt Gaussian blur. SVG blur filters aren't reliable across react-native-svg platforms. So each glow is a radial gradient following the same blur falloff, using the same positions, sizes and opacities.
- **Album art isn't bundled.**
  - Figma's sample covers are real albums used as placeholders. In the app, artwork comes from the music provider.
  - `Cover` shows a neutral placeholder when there's no artwork. That keeps third-party album art out of the repository.
- **YouTube Music isn't shown.** The design file has a YouTube Music badge and color. YouTube Music isn't a supported provider (plan.md §2), so `ProviderBadge` accepts only `apple_music` and `spotify`.
- **Icons are tinted at runtime.** The 34 Figma icons are stored unchanged in `assets/icons/`. `expo-image` renders them, and `tintColor` follows the theme. The Google icon keeps its own colors.
- **Expo Go first.** Every component uses only modules included in Expo Go (expo-image, expo-blur, react-native-svg, expo-font), so the UI can be reviewed in Expo Go with no development build.
