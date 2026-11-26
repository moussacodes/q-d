# Decisions

Product and technical decisions that are not obvious from the code. Newest first.

## 2026-11-26 · Save onboarding profile to Supabase (live mode)

- **Onboarding step 1 waits for the server in live auth mode.** Continue validates, writes `display_name`, `color` and `adult_confirmed_at` (the time Continue was tapped) to the person's own `profiles` row, and moves to step 2 only when the write succeeded. The button reads "Saving…" and ignores more taps meanwhile. A failure stays on step 1 with words for it: offline ("…nothing was saved. Check your connection…"), signed out (no row matched), refused by the database, or anything else. Editing the name clears the message. Mock auth mode is unchanged: the profile is kept in the session only.
- **The direct write was already allowed, so no migration.** The RLS migration grants `update (display_name, color, adult_confirmed_at)` on `profiles` to `authenticated` with an own-row policy; `supabase/tests/profile-save.test.ts` pins it (own row only, exactly those columns, other people's rows unchanged, anon denied, the table's checks).
- **Validation, in `src/domain/profile.ts`, matches the table.** A display name is trimmed and 1–30 characters, counted like Postgres's `char_length` (an emoji is one). A name with a control character (a pasted line break or tab) is refused with its own words; PRODUCT_SPEC says nothing more about names, so nothing else is. The color must be one of the design tokens' six swatches, now `avatarSwatches` in `src/design/colors.ts` (the mock data's `avatarColors` must equal it, a test checks). 18+ must be confirmed.
- **Settings writes the same way.** A color is written when it's picked and shown as picked only after it's saved. A name is written once, when the field is left, not per keystroke; leaving it blank or unchanged writes nothing and puts the saved name back. The header shows the saved name, so an unsaved edit never looks saved. In mock mode the name still saves as it's typed.
- **Reading back is the auth stack's.** `fetchSavedProfile` reads the row on sign-in and restart, and a finished profile goes Home. A failed read still counts as not finished (`fetchSavedProfile`, email sign-in card): the person sees step 1 again, and saving it again is harmless. **A teammate should decide** whether a failed read should show a retry instead.
- **Logs** name the step, a result and a code-shaped database code, never the name or color; the privacy canaries cover it (`src/services/privacyLogs.test.ts`, `__tests__/profile-save-live.test.tsx`).
- **Not done:** the onboarding screens themselves belong to the "Three-step onboarding" card; this card only persists what they collect. Untested against a live Supabase project. Figma not re-checked.

## 2026-11-26 · Privacy check merged into the live stack

- **`review/privacy-check` is merged on top of `review/live-search`** (both sit on the integration commit 3f03ba7). Both added the same 30-second database test timeout in `supabase/tests/harness/jest-setup.ts`; one copy is kept.
- **The guard now passes on the live code without new exceptions.** It flagged seven calls in `src/services/rpc.ts` and `src/services/rooms.ts` where `name` was the RPC's operation name and `code` a Zod issue kind, our `RpcErrorCode` or a SQLSTATE. Nothing sensitive was logged, so instead of allowlisting them: `callRpc`'s parameter is now `operation`; Zod issues are logged through `zodIssueFields` (`src/services/logFields.ts`) as `{ path, kind }`; and the Postgres code is logged through `loggableDbCode`, which keeps only a SQLSTATE or `PGRST…` code and logs anything else as `other`.

## 2026-11-25 · Live search and add-song

- **Live rooms search the canonical catalog.** In live mode `useCatalogSearch` uses `createAppleMusicCatalog` through the `catalog-search` Edge Function (`features/search/liveCatalog.ts`), called with the signed-in user's session token and the publishable key, built once per run. Mock mode keeps the labeled mock catalog. A failure reads as before ("Search isn’t working right now…", or the rate limit with its wait), never a raw error.
- **Adding sends the recording the server saved.** Live results carry `recordingId`; Add calls `enqueue_recording` with it, `allow_duplicate: false`. `already_in_queue` asks "Already in queue. Add it again?" (or "Playing now…") and **Add again** sends `allow_duplicate: true` with a new key, because the confirmed add is a new intent. Failures have their own copy (`not_allowed`, `room_ended`, `not_member`, no answer). Undo is `remove_queue_entry`, which the contract allows for the person who added the entry. Which results are already in the room is decided by recording id in live rooms and by the mock track id in mock mode.
- **Fixed: "Not on Spotify" for songs nobody had checked.** Live search only knows Apple Music, so its results said "Not on Spotify" in a Spotify room. A result now says which services it was checked on (`CatalogResult.checkedOn`; the Apple adapter sets `['apple_music']`, the mock catalog leaves it out because it knows every service). On a service it wasn't checked on, with no stored match, a song is `unknown`: it reads "Spotify version not matched yet" with a neutral dot, stays under the Spotify filter chip (it isn't ruled out), and the toast for a song that goes straight to the top says "up now · waiting for a Spotify match". A stored `track_matches` row still decides when there is one. This also changes the label for `unknown` everywhere from "On <service>" to "<service> version not matched yet".
- **Review: an add that got no answer keeps its key.** The server may have queued it already, so trying the same add again (same recording, same `allow_duplicate`) reuses the key and gets the stored answer instead of a second entry; above all after **Add again**, where a new key would really queue it twice. An answered add, or a different one, gets a new key (`unansweredAdd` in `liveRoom.ts`, the same rule as `useCall`).
- **"Playing now" only where q’d plays.** In a live room a song added to an empty queue becomes the room's song on the server, but nothing plays it from q’d yet, so the toast says "up now" instead of "playing now".
- Built, not verified against a real project or Apple's API: the Edge Function and `fetch` are faked in tests (`__tests__/live-search.test.tsx`, `features/search/liveCatalog.test.ts`). Figma not re-checked.

## 2026-11-25 · Live room screens

- **When rooms are live.** `LIVE_DATA_AVAILABLE` is now true, so `EXPO_PUBLIC_DATA_MODE=live` with both Supabase values valid makes the build's data mode `live` (it was mock until this card). Rooms then read Supabase, but only for a signed-in Supabase user: without a session no query runs. Sign-in is live in the same builds (`authMode`), so "only sign-in is live" no longer happens in practice. The choice is fixed for the build: `useRoom` and the other room hooks pick the live (`features/room/liveRoom.ts`) or mock (`useRoom.tsx`) version at startup, and both hand the screens the same shape. Mock mode is unchanged and still labeled.
- **Reads.** TanStack Query reads `rooms`, `room_rule_members`, `room_members` + `profiles`, `queue_entries` (playing and queued, by position) + `recordings` + `track_matches`, under `['room', roomId]` (`src/services/rooms.ts`, `roomQueryKeys.ts`). RLS limits them to rooms you're in. Every row is parsed; a row that doesn't parse is dropped and logged by field path. Realtime (`useRoomRealtime`) makes them refetch. `/room/QD-…` finds the room by code among your rooms (a live room wins over an ended one that had the same code). A room route waits in `RoomGate`: "Opening the room…", "This room isn’t open to you" (wrong code, ended, or not joined) or "Couldn’t load the room" with Try again.
- **Writes** go through the typed RPC client (`src/services/rpc.ts`): `create_room`, `join_room_by_code`, `create_room_invite`, `join_room_by_invite`, `end_room`, `enqueue_recording`, `reorder_queue`, `remove_queue_entry`. It maps the `{ code, details }` transport, raised or through the HTTP 400 `error_response` path, to the §2 codes, plus the client's own `network` (no answer) and `unexpected` (no `qd` hint, an unknown code, or a result that doesn't parse). It never throws and never logs arguments, server messages or results. `rpcErrorCodes` in `src/domain/rpc-error.ts` is checked against API_CONTRACTS.md §2 by a test.
- **Idempotency keys:** one per tap. A call that got no answer (`network`, `unexpected`, or a throw) keeps its key, and trying the same thing again reuses it, so the server replays instead of doing it twice. An answered error stored nothing, so the next tap gets a new key (`features/room/useCall.ts`). Queue edits use a new key per tap: a repeat after the entry is gone answers `entry_not_found` and the queue refetches.
- **A join or start that gets no answer now says so** ("Can’t reach q’d. Check your connection, then try again."), in mock mode too, instead of quietly turning Join back on. This is the offline join copy the integration entry left for this card.
- **End room** is in Listeners for the host: "End <room>?" ("The music stops for everyone, the code stops working, and nobody can join again.") with **End room** and **Keep it going**, then Home. Live calls `end_room`; mock ends the store's room. A failure says "Couldn’t end the room. Check your connection, then try again." Figma has no frame for this; Figma not re-checked.
- **Not on the server yet, so off in live rooms with copy that says so:** `advance_queue` (Skip), `report_playback_state` (play, pause, progress, the host's pause after 30 s), `request_playback`, `switch_playback_provider` (the host is never offered a switch), `override_track_match` ("Wrong version?") and `update_room_rules` (the host sees the rules as text with "Changing the rules isn’t connected to live rooms yet."). Under the controls a live room says "Playback isn’t connected to live rooms yet: the queue is shared, but q’d doesn’t play it from here. Skip comes with it." Play, Skip, Previous and Repeat are off. `leave_room` isn't built either, so there's no Leave. Home lists your live rooms but shows no mini player, since nothing plays from q’d in them.
- **Hosting a live room needs a real music service on the server's books.** `create_room` checks `provider_connections`, and nothing writes that table yet (the provider-connections metadata card). So a live `create_room` answers `provider_required` ("Connect a music service to start a room.") until that card lands, including for the labeled mock connection, which must never count as a real one. **Open question for the team:** write `provider_connections` on a real connect in that card, or earlier.
- **Also open:** a live account's onboarding profile isn't saved to `profiles` yet (auth entry), so its RPCs answer `profile_incomplete` ("Finish your profile before joining a room.") until the profile card lands. Live rooms use grey covers: recordings carry no Apple artwork color yet. Members without a finished profile show as "Someone".
- **Server state is cleared when the account changes** (`RoomsProvider`), so a different account, or none, never sees the last one's rooms from the cache. Review: the invite tokens the host's phone kept (`liveInvites`) are forgotten then too.
- **Review: a room shows only once its people and queue are read.** `RoomGate` says "Opening the room…" until the room row, the members and the queue have all answered, and "Couldn’t load the room" if any of them failed before it ever answered, so a queue that couldn't be read is never shown as an empty room. A refetch that fails after the room loaded keeps what was read (TanStack keeps `data`) instead of swapping the room for the error.
- **Review: no Skip that does nothing.** The "Not on <service>" and match notices keep their Skip button for the host, but it's turned off in live rooms until `advance_queue` exists; the live playback note under the controls says why.
- **Database test timeout, take two.** The integration branch's `testTimeout` in the `db` Jest project is ignored (Jest reads it only from the top-level config), so PGlite start-up still timed out under load. `supabase/tests/harness/jest-setup.ts` sets 30 s with `jest.setTimeout` instead.
- **Built, not verified.** Everything here is tested against a fake Supabase client at the service boundary (`src/test/fakeSupabaseData.ts`, `__tests__/live-room.test.tsx`), not against a real project, and not on a device. The fake filters like PostgREST but ignores the select list, so column names are checked only against the migrations by reading, not end to end.

## 2026-11-25 · Realtime Broadcast and Presence

- **Nothing in a payload is shown.** Every broadcast goes through `parseRoomEvent` and only decides which TanStack queries to refetch (`invalidationsFor`). A payload the app can't read (a newer `v`, an unknown type, another room's id, garbage) refetches everything about the room and is logged by field path and code only. The app never crashes on a payload.
- **The server side was already built** by the RLS and RPC cards: RLS on `realtime.messages` (members listen and track presence, nobody sends broadcasts) and `private.broadcast_room_event()` inside each RPC. No migration was needed; `supabase/tests/realtime.test.ts` checks what each RPC sends, that refused and replayed calls send nothing, that payloads hold only `v`, `type`, `roomId` and `at`, and that only members (also of an ended room) receive them. PGlite checks the policies and the rows, not the Realtime server; that needs `supabase start` on the Mac.
- **Presence carries the user id and role only** (`{ v: 1, userId, role }`, keyed by user id). The "N in the room" count comes from distinct user ids.
- **Host presence.** Before the first sync the host counts as present, so a phone that just joined doesn't flash "Host reconnecting". A host missing from the first sync was never seen, so they count as away (the rule in `host-presence.ts`), not as reconnecting for 30 seconds.
- **Connection loss is honest.** The channel reports `offline` on `CHANNEL_ERROR`, `TIMED_OUT` or `CLOSED` and retries after 1, 2, 4, 8, 16, then every 30 seconds; a successful join resets the delay and refetches the whole room, because events sent meanwhile are gone. The room shows "You’re offline" ("q’d can’t reach the room right now, so this may be out of date. It catches up by itself when you’re back.") and turns off Add a song and the queue edits, which go to the server. On the host's phone, losing the channel is the host leaving the room's presence, so the existing "Reconnecting", then "Paused · you’re offline" notices and the 30-second pause apply (API_CONTRACTS.md §4).
- **`room.ended` says so and waits for a tap.** The room is replaced by "This room has ended" (the host: "You ended this room…"; listeners: "<host> ended this room…") with **Back to Home**, which leaves the room. The host's player stops, and Home shows no mini player for it. Moving people off the screen without telling them why felt worse than one tap.
- **Mock mode keeps the mock store.** The store has the same two signals (`endRoom`, `setOffline`), with `/dev` toggles "Host ends the room", "This phone goes offline" and "This phone is back online", so the states can be tried and tested without Supabase. This closes the two states the UI state tests listed as missing.
- **Live rooms use it from the live room card on.** Until then `useRoomRealtime` is built and tested against a fake client at the service boundary, not against a real Supabase project.
- Figma not re-checked; the notices reuse the 4.3 notice's look.
## 2026-11-26 · Logs and analytics privacy check

- **Automated check, built.** A static guard (`src/services/privacyGuard.test.ts`) parses every file under `src/`, `app/`, `supabase/functions/` and `supabase/scripts/` with the TypeScript compiler. It fails when `console` is used outside the logger's console sink and the demo-reset CLI; when a log message isn't a fixed string (env and flag problems, which name variables only, are the reviewed exceptions); when a log, crash-report or breadcrumb call is handed a value named like a token, secret, password, email, PKCE verifier, challenge or state, code, room code, invite, song title, artist, album, ISRC, search query or user id; and when an analytics or crash-reporting SDK is installed or anything writes `analytics_events`. Each exception is listed in the test with the reason it's safe, and an exception that no longer matches anything fails too. A logger is any name `log`, `logger` or ending in `Log`/`Logger`, also as a property (`deps.log`), and breadcrumb messages must be fixed strings too. The guard reads names at the call site only, so a value renamed first (`const e = user.email`) isn't seen; the redactor and the runtime canaries cover that, and the test pins what it does and doesn't catch.
- **Runtime canaries.** `src/services/privacyLogs.test.ts` (services) and `__tests__/privacy-logs.test.tsx` (screens, mock mode) run every sensitive flow through the real app logger with recognizable canary values, capturing the console, a log sink and a crash-report transport: email sign-in and sign-up failures, the auth callback and Google with crafted error text, Spotify connect, refresh, 401 and 403, credential storage failures, joining by code until rate limited, invites, enqueue, reorder, remove and provider switching, catalog search errors, and failed queries and mutations. `supabase/tests/functions/catalog-search-privacy.test.ts` checks that the Edge Function prints nothing on any path and that its errors echo neither the query nor a token. The demo-reset script's output was already covered by `reset-demo-accounts-script.test.ts`.
- **Four leaks found and fixed,** each with a test that failed before the fix:
  - A Postgres constraint error's `Failing row contains (…)` (and `invalid input syntax for type …: "…"`) echoed the row, with song titles, artists and names, through `Mutation failed`. `redact.ts` now replaces both. The failing row is removed to the end of its line, because a title's own parentheses can nest or not close.
  - An error whose `code` held free text kept it. `redactError` now keeps only a code-shaped value (`^[A-Za-z0-9_.:-]{1,64}$`, or a number) that the string rules leave unchanged, so a room code, ISRC or token in `code` is removed too.
  - Spotify's error `reason` was logged as sent. Only an upper-case machine reason (`PREMIUM_REQUIRED`) is logged now; anything else is `other`.
  - The auth service logged a thrown error's `code` as `supabaseErrorCode` as is. It now goes through `loggableReason`, like the callback's codes.
- **User ids.** "Structured logging" (2026-11-24) keeps ids (`roomId`, `userId`) in logs, and the redactor still does. But no call site logs a user id, the auth service promises not to, and the static guard now flags a value named `userId`, so logging one needs a reviewed exception.
- **Analytics stays off and empty for the demo.** There's no analytics client, the flag is off and needs the person's opt-in (`analyticsAllowed`), no database function writes `analytics_events`, and signed-in users can neither read nor write it (`supabase/tests/analytics-privacy.test.ts`). Whoever builds analytics adds its payload to the privacy check.
- **Database test timeout, corrected.** The 30 seconds per database test (2026-11-25, "Integration of reviewed stacks") never applied: Jest ignores `testTimeout` inside a `projects` entry, so PGlite's `beforeAll` still ran under the 5-second default and whole database suites failed when the machine was busy. `supabase/tests/harness/jest-setup.ts` now sets it with `jest.setTimeout(30_000)` for the `db` project. Route tests failed the same way under load ("Unable to find an element with accessibility label: Email" on a screen's first render), so `src/test/jest-setup.ts` raises React Native Testing Library's `findBy…`/`waitFor` limit from 1 to 5 seconds for the `app` project. No assertion changed. Checked with two full `jest` runs at once (default and `--maxWorkers=50%`): 2644 of 2644 pass in each, where before 33 to 151 failed.
- **Physical-device acceptance isn't done.** The card's acceptance requirement is a check of device logs, the Xcode console and crash reports on an iPhone. That's Moussa's, on the Mac, with the checklist in DEMO_RUNBOOK.md ("Privacy check on a phone"). Until it's run, the card isn't claimed complete.

## 2026-11-25 · Integration of reviewed stacks

`chore/integration-2026-11-25` starts from `review/auth-callback` and merges, in order, `review/demo-account-reset` (both database stacks), `review/catalog-search`, `review/spotify-playback`, `review/invite-screen`, `review/ui-states` and `review/autoplay-label`. It's the base for the Realtime and live-data cards. Behavior changed only where two stacks had to be made to agree; every such choice is listed here. Each stack's own entries below are kept whole.

- **Merge notes followed.** The "which version wins" notes in "UI state tests" and "Review: overlap with the room-states stack" were applied as written: join-on-Home's `app/join.tsx`, `mockServer.ts` and `errorCopy.ts` win; `roomCodes.ts`, its test and its `/dev` links are gone; `src/domain/room-code.ts` was already identical on both sides.
- **UI state tests moved to Home's code field.** "Joining with a code" in `__tests__/ui-states.test.tsx` covers the same states on Home (joining, wrong or expired code, room full, room ended, too many tries, look-alike characters, a call that throws). Join-on-Home has no "Can’t reach q’d" copy: a call that throws turns Join back on, so that test checks that instead. An honest offline message for joining comes with the live room card.
- **One `RoomPlayer`.** The provider-UI stack's constructor (`adapterFor`, starting provider, `onEnded(entryId, providerKeptPlaying)`), `load(entry, startAtMs, provider)`, `standBy` and autoplay handling win. One hold flag covers every reason: `hold(away || pausedForHost || serviceMissing)`, set by one effect in `useLiveRoom` before it loads or stands by.
- **"Can't start" has one path.** The states stack's `RoomPlayer.canPlay` is gone. `availableOn` (`roomStore.ts`) now reads the stored matches through `availabilityOf`/`canPlayOnHostPhone` (an uncertain match counts; a missing or unresolved one doesn't) instead of the mock-only `unavailableOn`, and feeds `planSong`, so `standBy` is the only way a song doesn't start. Its tests moved from `RoomPlayer.test.ts` to `roomStore.test.ts`. A song with no stored match yet shows the match notice ("still matching"), not "Not on Spotify".
- **`serviceMissing` reads the real room's service** (`state.playsThrough`, the switched one, else the room's own). The `apple` development preview only shows the room through Apple Music, so it no longer holds the host's Spotify player.
- **Service-disconnected notice:** the provider-UI stack's `ServiceMissingNotice` (Reconnect Spotify, with connecting and failed states) wins; the states stack's copy with **Open Settings** is removed from `HostNotice.tsx`. Adding Open Settings next to Reconnect is left to the team.
- **Connect state keeps both stacks' fields.** `useProviderConnections` has `attempts` (connecting/failed, one connect per double tap) and `problems` (why it failed). A card says "Connecting…" while it runs, the specific reason when the service gave one (Premium, tester list…), and otherwise "Couldn’t connect X. Try again." A connect that throws reads as unreachable ("Couldn’t reach X. Check your connection and try again."), as the Spotify connection card decided; the provider-UI test for a throw now expects that.
- **Search keeps the canonical search card's hook.** `useCatalogSearch` returns `status` and `error`; Add a song shows `searchErrorMessage` (rate limit with seconds, "Search isn’t working right now. Try again in a moment."). The states stack's "Check your connection, then try again." copy isn't used; its offline test expects the search card's words.
- **`CatalogResult` has both `recordingId` and `matches`.**
- **Provider types.** `ProviderErrorCode` is the union of both stacks. The mock adapter's capabilities stay `mockCapabilities` (no real capability claimed) with `autoplay` set only when the labeled mock is asked to autoplay; `autoplay?: true` lives on `PlayerState`. The mock adapter's provider check now applies to autoplay tests too.
- **Error codes.** API_CONTRACTS.md §2 gains `not_between_songs` and `not_needed` (provider switching), and migration `20261125007000_switch_error_codes.sql` adds them to `private.error_codes()`, so the docs-vs-database test passes. Nothing raises them until `switch_playback_provider` is built. `RpcErrorCode` also gains `provider_unavailable`, `not_between_songs` and `not_needed`, so the app's list matches §2.
- **Two invite-link helpers exist:** `src/domain/invite-link.ts` (database stack: validates the 43-character token, tolerant parser) and `src/domain/invite.ts` (invite screen: builds links, knows `mock-` tokens). They agree on `qd://join?invite=<token>`. The live room card should make the app use one.
- **Tests that sign in fill the email form** (`fillEmailForm`), since the email auth card requires a valid email and password before Sign in.
- **Database tests get 30 seconds per test** (`testTimeout` in the `db` Jest project). PGlite start-up timed out at Jest's 5-second default when every suite ran in parallel.
- **`.env.example`** keeps the app's public section and appends the demo-reset operator section; `envExample.test.ts` checks the public names against `env.ts` and allows only the known operator names (never `EXPO_PUBLIC_`) besides.
- **Docs:** ARCHITECTURE.md rows and status lines were merged to name what each stack built. Figma not re-checked.

## 2026-11-25 · Auth callback and session refresh

- **`/auth/callback` is open in every sign-in state.** Google and email links land there (`app/auth/callback.tsx`, thin; logic in `features/auth/useAuthCallback`). It exchanges the PKCE `code` once, then moves on to onboarding or Home. If the link is opened again after signing in, it still ends up there, even when the code itself no longer works (used already, or forgotten after a restart): a signed-in person doesn't need it. Logs keep only a redirect's machine code (`otp_expired`); free text in a crafted link is logged as `other`.
- **Every failure has its own words** and a way back ("Back to sign in", "Go to Welcome"): an expired link (`otp_expired`, `flow_state_expired`), one that can't be used (used already, opened on another device, bad state, nothing in it), a cancelled sign-in, and a failed exchange. In mock auth mode it says sign-in isn't set up in this build instead of pretending.
- **Email confirmation links open the callback.** Sign-up passes `emailRedirectTo` = `authRedirectUrl()`.
- **Startup waits for the stored session.** In live auth mode the session starts as `restoring`; the splash stays up and the navigator stays hidden until Supabase reports the stored session (`INITIAL_SESSION`) and the profile is read. A signed-in person never sees Welcome on restart; the route guards then send each start URL to the right group. Mock mode doesn't wait. **The wait is bounded:** after 10 seconds (`RESTORE_TIMEOUT_MS` in `MockSession.tsx`) the splash gives way to Welcome, so a hanging refresh or profile read can't keep the app on its splash. If the session turns up later, the person moves on to onboarding or Home then.
- **The session is restored from `expo-sqlite`'s `localStorage`**, not SecureStore, per "Supabase client and device storage" (2026-11-24). The card's "SecureStore" wording predates that decision.
- **An expired or revoked refresh token signs out.** supabase-js drops a session it can't refresh and reports `SIGNED_OUT`; `AuthSync` returns to Welcome, at startup or while the app is open. A network failure keeps the session, as supabase-js does.
- **Refresh follows the app state** (unchanged from the Supabase client card): `startAutoRefresh` in the foreground, `stopAutoRefresh` in the background, tested in `src/services/supabase.test.ts`.
- **Known risk:** a profile read that fails at startup (offline) sends a finished account to onboarding, because a failed read counts as unfinished. It matters less until the onboarding profile is saved to `profiles` (every live account lands on onboarding until then), but an offline or retry state is still owed before the profile card lands.

## 2026-11-25 · Sign in with Google

- **Supabase's Expo flow, nothing native.** `signInWithGoogle` (`src/services/auth.ts`) asks Supabase for Google's address with `skipBrowserRedirect` (PKCE, set on the client), opens it with `expo-web-browser`'s `openAuthSessionAsync`, and exchanges the `code` in the returned URL with `exchangeCodeForSession`. `expo-web-browser` ships in Expo Go and was added with `npx expo install`. No Google client ID lives in the app or `.env`: Google's client ID and secret are set on the Supabase project.
- **Redirect URL.** `Linking.createURL('auth/callback')`: `qd://auth/callback` in development and store builds, `exp://<host>/--/auth/callback` in Expo Go. Both have to be on the Supabase project's redirect URL list.
- **Built, not verified.** It can't be tested end to end without Google turned on in the Supabase dashboard and a Google Cloud OAuth client. It hasn't been run on a device, so it isn't claimed to work.
- **Closing the sheet isn't an error.** Cancel, dismiss, or "access denied" on Google's page leaves the person where they were, with no message.
- **A code is exchanged once.** If the redirect arrives twice (the sheet returns it and the deep link opens `/auth/callback`), the second call shares the first exchange. A failed exchange is forgotten once it settles (so the link can be retried after a network failure), and every remembered code is forgotten on `SIGNED_OUT`, so reopening an old link after signing out fails honestly instead of reporting a session that's gone.
- **Supabase decides new or returning.** Welcome, Sign in and Create account all run the same Google flow; `AuthSync` routes to onboarding or Home from the profile row. Google's shared name (`full_name`) is suggested on onboarding step 1, as the mock did.
- **Not on the web.** The web build is for mock mode and guests, and its popup flow isn't built, so live Google on the web says it isn't available yet.
- **One sign-in at a time.** While the Google sheet is open, the email form and the other buttons are disabled, and the button reads "Opening Google…".

## 2026-11-25 · Email/password sign-in and account creation

- **Sign-in has its own mode, separate from room data.** `authMode` (`src/services/dataMode.ts`) is `live` only when `EXPO_PUBLIC_DATA_MODE=live` and both Supabase variables validate. Rooms still fall back to mock in that case (`LIVE_DATA_AVAILABLE` is false), so the strip reads "Mock data · only sign-in is live". With no `.env`, or `mock`, nothing changes: the mock session signs in and nothing touches Supabase.
- **One auth service.** `src/services/auth.ts` is the only code that calls `supabase.auth`. It returns outcomes instead of throwing and maps every Supabase error to an `AuthErrorCode` (`src/domain/auth.ts`). The screens show the copy for that code (`src/features/auth/messages.ts`), never Supabase's message.
- **A wrong password doesn't say whether the email has an account** ("That email and password don’t match an account").
- **An existing email on sign-up says so** ("There’s already an account with this email. Sign in instead."), including when email confirmation is on and Supabase hides it behind a user with no identities. It's what a person needs to hear, and sign-up already reveals it when confirmation is off.
- **Form checks run in both modes.** An email needs an `@` and a dotted domain (deliberately loose; the server decides). A new password needs 8 to 72 bytes (Supabase's minimum is 6; bcrypt reads 72). The too-long message says emoji and accented letters count for more, because the limit is bytes, not characters. Signing in only needs a password, so older accounts with shorter ones still work. This replaces "the email form accepts any input" from the auth-screens audit. Route tests now fill the form before pressing Sign in or Create account (`src/test/emailForm.ts`).
- **React Hook Form isn't added.** Two fields and one rule set don't need it; `validateEmailForm` is pure and tested. Add it when a longer form arrives.
- **Routing follows Supabase.** `AuthSync` (`src/features/auth`) listens for auth events. A sign-in reads the person's own `profiles` row: a finished profile (name, color and 18+) goes Home with that profile; anything else, including a failed read, goes to onboarding. Token refreshes and repeated events for the same person change nothing, so onboarding progress isn't undone. A `SIGNED_OUT` from anywhere returns to Welcome.
- **Sign out is local first.** `signOut({ scope: 'local' })` removes the session on the device before telling the server, so it never depends on the network.
- **Returning to signed out clears music-service tokens.** Sign out, or Supabase ending the session, also runs `providerCredentials.clearAll()` (through `clearProviderCredentials` in `src/services/auth.ts`), so the next person to sign in on the phone never inherits Apple Music or Spotify credentials. A failure to clear is logged without details and never blocks signing out.
- **Apple and Google say they aren't available yet** in live auth mode instead of starting a mock account. Google comes with the next card; Apple is the Mac card. In mock mode they still start mock accounts.
- **Logs carry codes, never input.** Failures log the step, our code, Supabase's code and the HTTP status. The email, password, tokens and user id are never passed to the logger.
- **Still open:** saving the onboarding profile to `profiles` (the onboarding/Supabase profile card). Until then, a live account that finishes onboarding goes back to onboarding on its next sign-in. "Forgot password?" still does nothing; password reset needs its own card.

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

## 2026-11-25 · Canonical catalog search (Apple catalog)

- **Search runs in an Edge Function** (ARCHITECTURE.md open decision 1, PRODUCT_SPEC.md § 13). `catalog-search` holds the Apple Music API developer token and serves everyone the same results: guests without a service, Android and the web. On-device MusicKit search would leave them out. The card asked for this; **a teammate should confirm**.
- **The developer token is minted in the function** from the MusicKit key in Edge Function secrets (ES256, 12 hours, replaced an hour early or after Apple rejects it). It never ships in the app. **Built, untested against the live API:** nobody has a developer key yet, so every test uses synthetic recorded fixtures.
- **One canonical recording per Apple song id.** Saving the same song again keeps its recording id and refreshes its metadata, so search is idempotent. Two Apple songs with the same ISRC (a single and its album copy) stay two recordings; whether to merge them is an **open question**.
- **Apple's artist credit is kept whole** (`['Delerium & Sarah McLachlan']`). Splitting at "&" would break "Simon & Garfunkel", and matching splits credits itself.
- **Version tags are read from the title** with the matching card's `parseTitle`, without `clean` (that's the explicit flag). Supabase deploys only what's under `supabase/functions`, so the function can't import `src/`: it uses `supabase/functions/_shared/matching-text.ts`, a copy of `src/domain/matching/text.ts` that a test keeps identical (review fix).
- **Songs missing an id, title, artist or a positive duration are skipped,** not invented. Artwork must be https; Apple's `{w}x{h}` template is stored and sized in the app.
- **Search results know only Apple.** `availableOn` is `['apple_music']`. **Open question before live search is wired in:** Add a song reads a missing provider as "Not on Spotify", which live search can't know yet. The app still uses the mock catalog, so nothing shows this today.
- **60 searches a minute per user,** counted in Postgres, because Apple's limit is per developer token and shared by everyone. Add a song waits 300 ms after typing before a live search; the mock doesn't wait.
- **New error code `provider_unavailable`** for a music service that can't answer (unreachable, timed out, misconfigured or an unexpected response). The database's code list has it too; another branch that rewrites `private.error_codes()` must keep it.
- **Add a song shows search errors** as plain copy ("Too many searches. Try again in 12 seconds.", "Search isn’t working right now…") and "Searching…" while a first search loads. Figma has no frame for these; Figma not re-checked.
- **Track and link lookups aren't built.** The live Apple catalog adapter's `getTrack` and `resolveLink` still say "not in this build".

## 2026-11-25 · Spotify playback adapter (aux)

Built, **untested on a device and against real Spotify.** It runs the shared PlaybackAdapter contract suite against a fake Spotify player (`installFakePlayer` in `src/test/fakeSpotify.ts`). The `realSpotify` flag stays off, so the app keeps the labeled mock.

- **A remote control over the Web API.** `SpotifyPlaybackAdapter` (`src/providers/spotify/playback.ts`) tells the Spotify app that's open on the host's phone what to play. The Spotify app plays the audio. q’d never streams, relays or rebroadcasts it. The Web API needs no native code, so this runs in Expo Go. The iOS SDK's App Remote, which PROVIDER_FEASIBILITY.md also names, isn't used here. **Open question for the team:** whether the demo needs App Remote too, for example to wake the Spotify app. That needs a development build and the Mac.
- **Endpoints:** `GET /me/player` (state), `GET /me/player/devices`, `PUT /me/player` (transfer), `PUT /me/player/play` (a track URI with `position_ms`, or a resume), `PUT /me/player/pause`, `PUT /me/player/seek` and `POST /me/player/queue`. None has been checked against Spotify's reduced development-mode endpoint set yet. Check them when the Spotify developer app exists.
- **`prepare` sends nothing.** Spotify can't load a track without playing it, and starting then pausing would play audio. So `prepare` remembers the track and position, `getState` reports it as paused, and `play` starts it at that position.
- **No active Spotify app.** `play` reads the device list and moves playback (`play: false`) to the active device, else to this phone's Spotify (`Smartphone`), else to the only device there is. It never guesses between several devices, because that could start music on someone else's speaker. Restricted devices are skipped. With none, `play` fails with `no_active_device` ("Open Spotify on this phone, then try again."), and the track stays ready.
- **Already paused or already playing isn't an error** (`ALREADY_PAUSED`, `ALREADY_PLAYING`). Pausing when no Spotify app is left isn't either, because nothing plays.
- **Errors:** 401 refreshes once, then asks to reconnect (`needs_authorization`). 403 `PREMIUM_REQUIRED` is `premium_required`. Other 403s are `playback_refused`, or `not_approved_user` for the development-mode refusal. 404 on a player endpoint is `no_active_device`. 400 is `invalid_argument`.
- **429 waits for `Retry-After`** (whole seconds, 1 s if missing or unreadable) up to 3 times. A wait longer than 10 s isn't made: the call fails with `rate_limited` so the UI can say so. A **5xx** is retried after 500 ms and 1 s, then fails with `provider_unavailable`. A **failed queue add is never retried**, because it may have worked and the song would be queued twice.
- **`enqueue` uses Spotify's queue.** The Web API can't reorder or clear it, so the room player should only enqueue what plays next. The room queue stays in Postgres. Tracks enqueued before `play` are held and sent once the first track starts.
- **`getState` reads Spotify every time.** The caller polls. If someone changes the song in the Spotify app, q’d reports what Spotify actually plays. A podcast episode or an unreadable item reads as idle. Tracks q’d started or queued come back as q’d's own objects, so matched metadata is kept.
- **`disconnect` lets go but keeps the account.** It pauses only what q’d started, and then sends nothing until `connect` or `prepare`. Tracks enqueued meanwhile are held and sent after the next `play`. `pause` still reaches Spotify when the next track is prepared, because the current one is still playing in the Spotify app. Forgetting the tokens is Disconnect in Settings (`disconnectProvider`, Spotify connection card).
- **Capabilities claim nothing untested:** `requiresExternalApp: true`. In-app audio, background playback and autoplay are all false. Spotify's autoplay is an account setting q’d can't read.
- **Spotify track metadata.** ISRCs come back in compact uppercase form, and a malformed one is dropped without hiding the track. `artworkBackgroundColor` is always null (ARCHITECTURE.md §4.2).

## 2026-11-25 · Spotify connection (OAuth)

Built, **untested on a device and against real Spotify.** Every test runs against a fake Spotify (`src/test/fakeSpotify.ts`). The `realSpotify` flag stays off by default, so the app keeps the labeled mock.

- **Authorization Code with PKCE, no client secret.** The app makes a random 86-character verifier and sends only its SHA-256 challenge (`S256`) and a random `state` to Spotify's authorize page, in the system sign-in sheet (`expo-web-browser` `openAuthSessionAsync`). The code is exchanged with the verifier. `expo-crypto` supplies the randomness and the hash. Both ship in Expo Go. `expo-auth-session` wasn't added: `expo-linking` already builds the redirect URL, and the PKCE code is small and tested against the RFC 7636 example.
- **The client ID is public** (`EXPO_PUBLIC_SPOTIFY_CLIENT_ID`, 32 hex characters, validated in `env.ts`). `.env.example` lists the name only. A Spotify client secret never goes in the app.
- **Three scopes, the least remote control needs:**
  - `user-read-playback-state`: read the player and the device list (what plays, where, and whether a Spotify app is open).
  - `user-modify-playback-state`: play a track, pause, resume, seek, add to Spotify's queue, move playback to this phone.
  - `user-read-currently-playing`: the playing track for Now playing.
  - **Not asked for:** `streaming` (q’d never plays Spotify audio itself), `user-read-private` and `user-read-email` (q’d doesn't need the profile; Premium shows up as Spotify's `PREMIUM_REQUIRED` refusal of the first play), library and playlist scopes (playlist import is post-demo and adds its own). A grant missing one of the three is refused.
- **Tokens live only in SecureStore** (`providerCredentials`, Keychain, this device only). No credentials in Postgres: when the Supabase cards add `provider_connections`, its row holds the provider and timestamps only. This branch writes no row, because no table exists here yet.
- **Nothing secret is logged.** Log entries carry an HTTP status, Spotify's error code word or player reason, and the endpoint path. Tests replace the logger to check that the raw arguments, before redaction, never contain a token, code, verifier or state.
- **`state` is checked first.** A redirect whose `state` doesn't match is `auth_failed`, even if it says `access_denied`, and its code is never exchanged. Closing the sheet or tapping Cancel on Spotify's page is not an error: the service just stays not connected.
- **Refresh.** A token is refreshed 60 seconds before it expires. Concurrent callers share one refresh. A rotated refresh token replaces the old one, and the old one is kept when Spotify sends none. A refused refresh (`invalid_grant`) clears the tokens and asks to reconnect. A refresh that fails on Spotify's side (5xx, 429, offline) keeps them. A refresh still in flight when the person taps Disconnect doesn't save its new tokens.
- **A 401 refreshes once and retries.** A second 401 clears the tokens and asks to reconnect (`needs_authorization`).
- **Connect checks the account** by reading the player (`GET /me/player`). Spotify's development mode refuses a user who isn't on the app's user list with a 403 whose wording isn't documented, so q’d matches it loosely ("not registered", "developer dashboard"), and only on a 403 without a player `reason`, so a player refusal can never drop the tokens. That's `not_approved_user`, and its tokens are dropped. Premium isn't known at connect, so Settings keeps the hint "Premium needed to play rooms".
- **Disconnect clears the tokens.** With the flag on, Connect runs the real flow and Disconnect forgets the tokens on this phone. With it off, both stay mock.
- **New error codes** in `ProviderErrorCode`: `not_configured`, `needs_authorization`, `auth_failed`, `premium_required`, `not_approved_user`, `no_active_device`, `playback_refused`, `rate_limited`, `provider_unavailable` (API_CONTRACTS.md §5).
- **Honest copy** (`features/connections/connectionCopy.ts`). A Connect that didn't work says why on the service card: "Spotify Premium is needed to play rooms through Spotify.", "This Spotify account isn’t on q’d’s tester list yet. …", "Spotify isn’t connected yet. Tap Connect to try again.". Start room stays disabled.
- **Redirect URI: open.** It's `Linking.createURL('spotify-auth')`: `qd://spotify-auth` in a development build, and an `exp://<computer's address>/--/spotify-auth` URL in Expo Go. Spotify only accepts redirect URIs listed in its dashboard, and **the Spotify developer app card isn't done**, so nothing is registered and no client ID exists yet. Whether testing in Expo Go is practical (its address changes) is for that card to decide.

## 2026-11-25 · Invite / QR screen

Figma audit of 3.5 Invite people. Figma wasn't re-checked: a person still compares it with `20 · Mobile`. Mock mode only.

- **Layout (from `feat/invite-qr`, Baron's work in progress).** The code card sits centered under the header, the QR code fills the card's width up to 320 pt so a phone across the table can scan it, and Copy link and Share are pinned to the bottom of the sheet (`SheetScreen` gained `contentStyle` for this; it already had a footer slot). Figma 3.5 places them differently, so **a teammate should confirm** the layout.
- **The QR code is real.** It's drawn with react-native-svg from the `qrcode` package's pure-JavaScript encoder (`src/components/QrCode.tsx`), error correction M and the standard four-module quiet zone, so it works in Expo Go and on the web with no native code. `expo-clipboard` copies the link and React Native's `Share` shares it; both ship in Expo Go.
- **It encodes an invite link, never the room code.** The link is `qd://join?invite=<token>` (API_CONTRACTS.md, `create_room_invite`). Tests check that no drawn QR value is or contains the room code. The code is shown on its own for reading aloud, and screen readers spell it out ("Q D, 7 K 4 F 9 X").
- **Mock tokens are deterministic and labeled.** They're `mock-` plus 32 hex characters (the length of a 128-bit token), made from the room and a counter, so unlike real tokens they aren't secret. The sheet shows a "Mock invite · not a working link" chip. Real tokens come from the server's random generator.
- **The host's phone keeps the token.** The server stores only a hash (DECISIONS 2026-11-24 · Row level security, on the DB branches), so the app can't read a token back. Opening Invite again reuses the link this phone made; the first open calls `create_room_invite`. After an app restart (once tokens aren't mock), opening Invite would make a new link and the old QR code would stop working. **A teammate should confirm** that, or whether the token should be kept in SecureStore.
- **"Make a new link"** calls `create_room_invite` again, which replaces the old token (the contract's "the host can replace it"). The sheet says the old QR code and link stop working and the room code stays the same. Figma has no control for this.
- **Only the host invites** (PRODUCT_SPEC.md §4). Anyone else who reaches the sheet (the listener preview, a stale link) sees "Only <host> can invite people." with no code, QR code, link or Share, and no invite is made.
- **The subtitle follows the rules.** It says guests can "join and add songs" only while everyone can add songs; otherwise just "join". Both say no music service is needed.
- **Loading and errors.** While the invite is being made the QR area says "Making an invite link…" and Copy link and Share are disabled. An error shows in words with Try again. If "Make a new link" fails, the current QR code and link stay, and the line under the button says so ("The current link still works."). A kept invite that has expired isn't shown: opening Invite makes a new one. "Copy link" turns into "Link copied" for two seconds and is announced to screen readers.
- **An invite link opens `/join`.** The contract's link needs a route, so `app/join.tsx` comes back, but only to handle `?invite=`: it calls `join_room_by_invite` and opens the room, or explains the error (`invite_invalid`: expired or replaced, plus `room_full`, `room_ended`, `rate_limited`) with Go to Home. Without a token it goes Home, so typing a code still happens only on Home. This reuses the path the 2026-11-20 entry removed, so **a teammate should confirm** it. Wrong tokens count toward the same mock attempt limit as wrong codes.
- **Not done:** `qd://` links don't open Expo Go (it uses `exp://`), so scanning needs a development build. Someone signed out who opens a link lands on Welcome and the token is lost. Universal links and keeping the token through sign-in come later.

## 2026-11-25 · Create room and join room screens

Figma audit of 2.4 Start a room and of joining with a code, which now lives on Home (see "Join with a code on Home" below). Figma wasn't re-checked: a person still compares both with `20 · Mobile`. Mock mode only; the RPC cards wire the real `create_room` and `join_room_by_code`.

- **Joining waits for the server's answer.** Home's arrow (or Go) calls `join_room_by_code` and opens the room only when it says yes. While it's out, the line under the field says "Joining QD-…", and the field and the arrow are disabled, so a second tap sends nothing. Every tap sends its own idempotency key.
- **Every join error the contract names has its own line** under the field, and the code stays so it can be fixed: `code_invalid` ("doesn't match a room… mistyped or expired"), `room_full`, `room_ended`, `rate_limited` (with the wait from `retry_after_seconds`), `profile_incomplete` and `not_authenticated`. A wrong code and an expired one get the same words, as the contract requires, so codes can't be probed. Any other code reads "Couldn't join right now", never a raw code. Editing the code clears the line.
- **Look-alike characters are pointed out, not changed.** Codes never use `0`, `O`, `1` or `I` (DECISIONS 2026-11-24 · create_room, on `feat/create-room-rpc`, which **a teammate still has to confirm**). A code with one says so under the field and keeps Join disabled, without calling the server. They can't be mapped to the right character, because both halves of each pair are left out.
- **Mock join answers.** This replaces "Any other complete code opens Kitchen Disco" from the 2026-11-20 entry: the mock now answers like the contract, so the error states can be tried. A sample room's code opens that room. `QD-FULL22` is full, `QD-ENDED2` has ended, `QD-STALE2` stands for an expired code, and anything else is wrong. After five wrong codes in a row, joining pauses for 30 seconds (`rate_limited`), checked before the code, as the contract says. Those two numbers are mock values; the real attempt limits are still open (PRODUCT_SPEC.md § 13).
- **Start a room checks the name:** trimmed, 1–40 characters, like `create_room`. The field stops at 40 characters, and a blank name says "Give the room a name." with Start room disabled. It still starts filled in with "Sunday Slow Burn".
- **No mode choice.** Start a room sends `mode: 'aux'` and never mentions `sync`; a test checks it.
- **Start room waits for `create_room`.** It reads "Starting…" and ignores more taps until the answer, then opens the room. An error (`provider_required`, `profile_incomplete`, `invalid_input`…) appears under the button in words. The screen still asks for a service before it lets you start, so a guest is never asked for one.
- **The rule choices are labeled.** Each Everyone / Chosen / Only you row reads its rule ("Add songs", "Play, skip, reorder, remove") to screen readers.
- **Code.** `src/domain/room-code.ts` holds the alphabet and code helpers, `src/domain/room-name.ts` the name rule and `src/domain/rpc-error.ts` the error codes. The mock RPCs are `src/features/room/mockServer.ts`, the copy is `errorCopy.ts`, and Home's field is `JoinWithCode.tsx`. Home and Start a room no longer import sample data from `src/test`, so they're off the lint exception list.

## 2026-11-25 · UI state tests

- **Every non-happy state has a test** in `__tests__/ui-states.test.tsx`: loading, empty queue, unavailable and low-confidence songs, host reconnecting, no music service (guest), music service disconnected, wrong or expired code, room full, room ended, too many tries, and offline.
- **Fixed while testing, all small:**
  - **Join accepted any six characters** and always found Kitchen Disco, so a wrong code, a full room or an ended room couldn't be shown. Join now calls a mock `join_room_by_code` (`src/features/room/roomCodes.ts`) when you press it, reads "Joining…" while it's out, and shows each error with its own copy, with Try again for "Too many tries" and "Can’t reach q’d". Wrong and expired codes read the same ("That code doesn’t work"), as decided on 2026-11-19. `/dev` links each one.
  - **Review change: no "Room found" preview before Join.** The first version looked the code up as soon as it was complete and showed the room before Join. `join_room_by_code` checks and joins in one call and has no read-only lookup, so the preview would have shown something the real app can't. The panel is gone; Join opens the room or explains why not. If the team wants Figma 2.3's preview back, it needs a new RPC (and the join-on-Home stack below removes this screen anyway).
  - **Review change: the mock matches join-on-Home's.** It uses the contract's error names and shape (`code_invalid`, `room_full`, `room_ended`, `rate_limited` with `retryAfterSeconds`, `profile_incomplete`, `not_authenticated`; `network` is only the client's "no answer" state), and codes from the room-code alphabet, which has no `0`, `O`, `1` or `I`: `QD-FULL22` is full, `QD-ENDED2` has ended, `QD-STALE2` is expired, the same codes as `src/features/room/mockServer.ts` on `feat/create-join-screens`. Too many tries comes from five wrong codes in a row (30 s pause), like that mock, not from a special code. `QD-NETDWN` is mock-only: the call throws. A code with a look-alike character says codes never use them and isn't sent. `src/domain/room-code.ts` is a byte-for-byte copy of that stack's file, so the two merge cleanly.
  - **Add a song flashed "No songs match" before results arrived,** and a failed search showed the same thing. It now says "Searching…" while a query is out and "Search isn’t working right now" when it fails.
  - **Up next with an empty queue was a blank sheet.** It shows "The queue is empty", like the room.
  - **A host whose room's service was disconnected in Settings kept "playing".** The room now says "Spotify isn’t connected", holds the player, turns Play off (the mini player too) and links to Settings. The room and queue are kept; after reconnecting, the host presses Play. Listeners never see it: they don't need a service.
- **Not covered, because the state doesn't exist in the app yet:** a room that ends while you're in it (`room.ended`, Realtime card) and a lost connection inside the room (Supabase and Realtime cards). An unknown code typed into the room URL still shows the sample room in mock mode; the room route loads by code once Supabase lands.
- **When this stack merges with join-on-Home** (`feat/join-from-home` and `feat/create-join-screens`, which remove the code-entry Join screen): keep that stack's `app/join.tsx`, `mockServer.ts` and `errorCopy.ts`, drop this card's `roomCodes.ts` and its `/dev` links, and re-point the "joining with a code" tests in `__tests__/ui-states.test.tsx` (and the guest join in `provider-optional.test.tsx`) at Home's code field. The states to keep covering are the same: joining, wrong or expired code, room full, room ended, too many tries with the wait, look-alike characters, and no connection.

## 2026-11-25 · Host reconnecting

- **The grace period is the spec's 30 seconds** (PRODUCT_SPEC.md §4, API_CONTRACTS.md §4), `HOST_RECONNECT_GRACE_MS`. Nothing new to confirm.
- **One pure rule decides** (`hostStatus` in `src/domain/host-presence.ts`): host present → connected; gone under 30 s → "Host reconnecting" with the seconds left; gone 30 s or more → paused. A host this phone has never seen counts as away, so a listener never sees playback controls for a phone that isn't there. A clock that jumps backwards never shortens the countdown's elapsed time below zero.
- **What's disabled while the host is away:** play, pause, previous, skip and repeat, on the room screen and the mini player, because in aux the host's phone carries them out. Whoever the control rule lets in sees "Playback controls come back when the host’s phone reconnects." Adding songs and the host's queue edits stay on: they're RPCs to the server, not to the host's phone.
- **The room pauses, the queue is kept.** After 30 s the host's player pauses and the room is marked paused for the host. Listeners see "Paused" with the room and queue intact.
- **A returning host resumes by hand.** Within 30 s nothing paused, so the banner just goes. After a pause the host sees "You’re back" and **Resume** (the big Play does the same); listeners see "Paused · <host> is back" and their controls stay off until the host resumes. In mock mode the store already is the room's state; the real app refetches first.
- **The host's own phone shows it too** ("Reconnecting", then "Paused · you’re offline"), matching API_CONTRACTS.md §4: the host's app pauses its player when it can't reach Supabase for 30 seconds.
- **Mock mode:** `/dev` has "Host’s phone leaves" and "Host’s phone returns" for the sample room, plus three previews: `?view=reconnecting`, `?view=host-away` (listeners) and `?view=host-back` (host). Realtime Presence wiring is its own card; it calls the store's `setHostPresent`. Figma not re-checked; the banners reuse the 4.3 notice's look.

## 2026-11-25 · Availability and low-confidence states

- **The stored match decides, not the screen.** Every screen reads a song's `TrackMatch` for the room's service through `availabilityOf` (`src/domain/availability.ts`): `playable`, `uncertain` (a warning is set), `unavailable` (no track) or `unknown` (nothing stored yet). Mock fixtures get their matches from the real matcher run against made-up candidates, so "Way Bigger" is a low-confidence match on Spotify (81/100) and "Ocho Rios" an explicit/clean conflict (95/100).
- **A low-confidence match plays, never silently** (PRODUCT_SPEC.md §6, rule 7). The spec keeps the mapping with a warning; it doesn't say to hold the song. So it plays, and everyone sees "Might be a different version" with the confidence. The host gets Skip; listeners are told the host can skip it. An explicit/clean conflict shows "Explicit/clean version differs". **Open question for a teammate:** should the host instead confirm before an uncertain match starts? Nothing in the spec or decisions asks for that, so it isn't built.
- **An unavailable song never plays.** The 4.3 notice was already honest, but the mock player still "played" the song Spotify doesn't have, and the room moved on when it ended. Now the host's player stops, the timeline stays at 0:00, Play, Previous and Repeat are disabled (on the mini player too), and only Skip works. The room-screen test that relied on the old behavior checks this instead; songs moving on by themselves are still covered in `RoomPlayer.test.ts`.
- **A song with no stored match doesn't play either.** Mappings are resolved when playback needs them (PRODUCT_SPEC.md §6), so the host's phone waits rather than guess, and the room says "Not matched on Spotify yet". Mock mode always has a match, so this state appears only once real matching lands.
- **Search results and queue rows warn ahead.** Add a song shows "Closest match on Spotify · may be another version" or "Explicit/clean version differs on Spotify" next to "On"/"Not on Spotify"; queue rows show "May be another version on Spotify". `CatalogResult.matches` is proposed in API_CONTRACTS.md for the canonical search card.
- **"Wrong version?" is left to its own card.** `MatchNotice` takes an `onWrongVersion` prop and shows the button only when it's passed, so nothing offers a correction that doesn't work yet.
- **Review fixes:** the "added" toast said "playing now" for a song the host's phone won't play; it now says "up now · not on Spotify". The `?view=apple` preview shared the room's Spotify player, so it decided what plays with Spotify's matches while the screen showed Apple Music's; each service now gets its own mock player.
- **Preview:** `/room/QD-7K4F9X?view=uncertain` (listed in `/dev`). A person still compares the notice with Figma `20 · Mobile`, which has no frame for it; it reuses the 4.3 notice's look.

## 2026-11-25 · Review: overlap with the room-states stack, and which version wins at merge

The provider-UI stack (`feat/service-settings` → `feat/provider-switching` → `feat/autoplay-label`) and the room-states stack (`feat/availability-confidence` → `feat/host-reconnecting` → `test/ui-states`) were built in parallel and touch the same pieces. Whoever merges the second one should resolve them like this:

- **`RoomPlayer.hold(on: boolean)` and `isHeld`:** now the same on both stacks. Holding pauses, a song loaded while held stays paused, `play()` does nothing while held, and releasing never plays. Keep one copy. On merge, one flag covers every reason: `hold(away || pausedForHost || serviceMissing)`. This stack's addition: holding while provider autoplay runs stops the autoplay instead of pausing it.
- **`RoomPlayer` constructor and `load`:** this stack's version wins (`adapterFor` plus a starting provider, and `load(entry, startAtMs, provider)`), because switching services needs it. The states stack's check that stops a song whose match is missing or unresolved (`canPlay`/`availabilityOf`) should feed `availableOn` in `planSong`, so `RoomPlayer.standBy` stays the only code path for "this song can't start". It replaces the mock-only `unavailableOn` field.
- **The service-disconnected room state:** both stacks added a `ServiceMissingNotice` ("Spotify isn’t connected"). This stack's version has **Reconnect Spotify** in place, with connecting and failed states. The states stack's version has **Open Settings**. Keep this stack's component and decide whether to add Open Settings next to Reconnect. The states stack reads `base.playsThrough`. After a switch, the room's service is the store's `playsThrough`, so use that one.
- **Adapter types:** the states stack renames the adapter's state to `PlayerState` and moves `PlaybackCapabilities` to `src/domain/playback.ts`, which already has `autoplay`. Move this stack's `autoplay?: true` marker onto `PlayerState` and drop the duplicate capability field.
- **Error codes:** `not_between_songs` and `not_needed` (`switch_playback_provider`) aren't on either other stack. See the provider-switching entry for the `private.error_codes()` note.

## 2026-11-25 · "Autoplay by Apple Music/Spotify"

- **The mock autoplays now.** This replaces "No autoplay is promised: the mock doesn't autoplay" (2026-11-24 · Empty queue). When the last queued song ends by itself and the host's service keeps playing, the mock plays a fixed list of its own picks. A song that's skipped doesn't start autoplay: the room shows "Nothing playing yet" as before. Whether Apple Music's `ApplicationMusicPlayer` and Spotify App Remote really keep playing after q’d's last song still has to be checked on a device.
- **Everyone is told whose songs they are.** The room shows an **Autoplay by Spotify** chip instead of "Nothing playing yet". The host sees the song and "The queue ran out, so Spotify is picking songs on your phone. q’d and the room didn’t choose them." Listeners see "Spotify is choosing" and "The queue ran out, so the host’s Spotify is picking songs. q’d and the room didn’t choose them." They don't see the song, because `report_playback_state` sends no song for `autoplay`. Anyone who can add songs also reads "Add a song and the queue takes over." Home's and Settings' mini player read "Autoplay by Spotify".
- **The queue always wins.** Adding a song during autoplay plays it at once and the label goes away. A host whose phone can't play (service disconnected) stops autoplay too.
- **Only in `aux`.** `src/domain/autoplay.ts` never labels autoplay in `sync (beta)`, where it stays off (PRODUCT_SPEC.md §5).
- Whoever the control rule lets in can pause and resume autoplay. There's no Skip for it, because q’d doesn't choose those songs. Figma has no frame for this state; Figma not re-checked.

## 2026-11-25 · Provider switching between songs

- **A song that isn't on the room's service never starts.** Before, the mock played it anyway. Now the host's player stands by (`RoomPlayer.standBy`) at 0:00 with Play disabled until the host skips it or switches. Because it never started, a switch always happens between songs (PRODUCT_SPEC.md §6).
- **The host is asked, and only the host.** When the song is on another service the host connected, the notice says "This song isn’t on Spotify, but it’s on Apple Music. Skip it, or switch to Apple Music for this song and the ones after it." with **Skip** and **Switch to Apple Music**. This replaces the "Switch for next song" button that did nothing (2026-11-24). Without the other service connected, the notice still only offers Skip. Listeners' text is unchanged and they get no buttons.
- **The switch keeps the new service.** The room plays this song and the ones after it through Apple Music, and the room's badge, palette and Settings note follow. It doesn't switch back by itself, because that would be a second switch the host didn't ask for. **Open question for the team:** PRODUCT_SPEC.md says "switch services for that song" and PLAN.md says "for the next song". Neither says whether the room should go back afterwards. This build keeps the new service; confirm or change it.
- **Everyone is told.** While the switched song plays, the host sees "You switched from Spotify to Apple Music between songs. The room plays through Apple Music now." and listeners see "The host switched from Spotify to Apple Music between songs."
- **The queue warns the host ahead of time.** A coming song that can be switched reads "Not on Spotify · you can switch to Apple Music when it comes up" on the host's phone. Everyone else still reads "Not on Spotify · the host can skip it".
- **Contracts.** `switch_playback_provider` is added, with the error codes `not_between_songs` and `not_needed`. It's a proposal for the RPC contracts card. The rule lives in `src/domain/provider-switch.ts` (`planSong`, `checkSwitch`). Neither code collides with an existing one (`provider_required` and `stale_state` are reused with their documented meaning). **At merge with `feat/rpc-contracts`:** its test checks that this table matches `private.error_codes()`, so the migration that adds `switch_playback_provider` must add `not_between_songs` and `not_needed` there too. The mock answers a repeated switch with `not_needed`; the real RPC replays the first result for the same `idempotency_key`.
- Mock only. The real adapters still have to resolve the song on the new service and hand playback over on a device. Figma not re-checked.

## 2026-11-25 · Music-service settings: connect, change, disconnect

- **A connect only counts once it worked.** A service shows as connected only when its adapter answers `connected`. While a connect runs, the card says "Connecting Spotify…" and its Connect button is disabled, so a second tap can't start another. A connect that fails or throws says "Couldn’t connect Spotify. Try again." and keeps Connect. Before, any answer from the adapter showed as connected. This applies wherever the service cards appear (onboarding step 2, Start a room, Settings).
- **Disconnecting the service your live room plays through asks first.** In aux only the host's phone plays, so it would stop the room's music. Settings shows "Disconnect Spotify?" under the card: "Sunday Slow Burn plays through Spotify on this phone. Disconnecting pauses the music for everyone in the room. The room and its queue stay, and you can reconnect any time." with **Disconnect and pause** and **Keep connected**. Disconnecting any other service, or one while you're only a listener, happens at once as before.
- **After that, the room holds.** The host's player pauses where it was and starts no other song, and Play is disabled in the room and the mini player. Only the host sees "Spotify isn’t connected" with **Reconnect Spotify**. Listeners see the music paused, which is all their phones would know. Reconnecting doesn't resume by itself; the host presses Play. That includes a song that came up during the hold (the host skipped): it waits paused at 0:00. `RoomPlayer.hold(on: boolean)` has the same signature and meaning as the one on `feat/host-reconnecting`, so the two merge cleanly. Real mode reports the pause with `report_playback_state` once that exists.
- **"Play rooms through" is for the next room.** While you host, Settings says "Sunday Slow Burn keeps playing through Spotify. This choice is for rooms you start next." A live room changes service only through the provider-switching prompt.
- **Not merged: provider logos** (`feat/provider-logos`). Apple's and Spotify's brand guidelines limit how their marks may be recolored and placed, and nobody has checked the WIP against them yet, so the services keep their color dots.
- Mock only. The real connect and disconnect (OAuth, revoking authorization, the `provider_connections` row) come with the provider cards. Figma not re-checked.

## 2026-11-24 · Supabase client and device storage

- **The Supabase session lives in `expo-sqlite`'s `localStorage`,** which is what Supabase's Expo guide recommends now and ships in Expo Go. On the web it's the browser's own `localStorage`, or memory where storage is blocked. The session isn't encrypted at rest there; that's Supabase's standard setup, and the session is revocable from the server. Music-service tokens are a different case and go to SecureStore.
- **Provider credentials use the Keychain with `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`.** The host's phone can refresh a Spotify token while it plays with the screen locked, and the token never moves to another device through a backup. Unreadable entries are deleted, so the person reconnects instead of the app crashing.
- **On the web, provider credentials stay in memory.** The web has no secure storage, and any script on the page can read browser storage. The web build is for mock mode and guests, who never connect a service.
- **No client without a valid env.** `getSupabase()` returns null until both Supabase variables validate, so mock mode needs no `.env` and makes no network calls.
- **Zustand isn't added yet.** Nothing needs it: the mock room store is React context and moves to TanStack Query with the Supabase cards. It comes in when a small transient player or room state needs it (ARCHITECTURE.md §4.12).
- **Session refresh follows the app state** on devices (start in the foreground, stop in the background), as Supabase recommends for React Native.

## 2026-11-24 · Structured logging and crash-report filtering

- **Redaction happens inside the logger,** before any sink, so no sink (console, crash reporter, a future service) can leak. It removes credentials, emails, room codes, invite tokens and listening history, in nested objects, arrays, Maps, Sets, Errors and their causes, and inside strings.
- **Redaction errs toward removing too much.** Whole values under keys like `code`, `title`, `name`, `url`, `query` and anything containing `token`, `email`, `track`, `queue` or `artist` are replaced, even when they'd help debugging. Ids (`roomId`, `userId`) and error codes stay.
- **Log messages are fixed strings.** A song title in free text can't be told apart from other words, so data goes in the context object, where its key decides.
- **No crash-reporting service yet.** None is planned in the docs, so none was added. `crashReporting.ts` holds the privacy filter (`beforeSend`), manual breadcrumbs and a global error handler, and sends nothing until a transport is set. Whatever service is picked later must keep `crashReportingPolicy`: no session replay, no automatic breadcrumbs or event capture, no default PII, no screenshots.
- **Failed crash uploads are dropped,** not retried, so a report can't be sent after the person signs out.

## 2026-11-24 · Environment validation and feature flags

- **Nothing in `.env` is required.** Mock mode must keep working on any machine, so a missing or invalid variable never stops the app. It's reported by name in a development warning and falls back to a safe default. This is how ARCHITECTURE.md's "fail fast with a clear message" applies while mock mode is the default.
- **Supabase's key variable is `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.** It accepts a publishable key (`sb_publishable_…`) or the legacy `anon` JWT. Secret keys (`sb_secret_…`) and `service_role` JWTs are rejected, because every `EXPO_PUBLIC_*` value ships inside the app.
- **`live` still falls back to mock.** Asking for `live` without valid Supabase values, or before the live data layer exists, keeps mock data and its label. Otherwise `live` would show sample data without the "Mock data" strip.
- **`sync` is locked off in code,** not just off by default. `EXPO_PUBLIC_FLAG_SYNC=true` is ignored with a warning, and the list of modes a host can pick is always just `aux`.
- **Flags are read from `EXPO_PUBLIC_FLAG_*` at build time.** They're public and per build, not remote config. Remote flags can come later if the beta needs them.

## 2026-11-24 · Welcome, sign-in and account-creation audit

- **Audited against the card, not Figma.** Welcome, Sign in and Create account offer all three entry points: Apple, Google and email. Welcome's email button opens Create account; Sign in and Create account each have the email form plus Apple and Google. A person still has to compare them with Figma `20 · Mobile`.
- **The wordmark says q’d with the curly apostrophe.** The Logo drew `q'd` with a straight one, although its accessibility label was already curly (PRODUCT_SPEC.md §9).
- **Still mock:** the email form accepts any input, and "Forgot password?" does nothing. Validation and password reset come with the email auth card.

## 2026-11-24 · Track matching

The rules are PRODUCT_SPEC.md §6. These are the numbers and edge cases the matching card had to pick. All of it is in `src/domain/matching`, pure and deterministic.

- **Score out of 100:** title 40 (character-pair similarity of the title without version markers or credits), primary artist 25 (20 if they're credited but not first), duration 20, album 5, explicit status 5, version markers 5.
- **Duration bands:** within 2 s gets 20, within 5 s 14, within 10 s 6, further off 0. A missing duration gets 10 and a missing album 3, so missing data neither wins nor sinks a match.
- **Automatic match:** at least 90, and at least 5 points ahead of the next candidate that's the same version with the same explicit status. Below 90, or without that lead, the best candidate is kept with a `low_confidence` warning. Below 50 nothing is kept.
- **Exact ISRC wins** and gives 100, even across version markers ("2011 Remaster" with the same ISRC is the same recording). Two exceptions need review instead: an explicit/clean conflict (`explicit_conflict`), and a duration more than 10 s off, which suggests bad data (`low_confidence`, capped at 89). Several tracks with the same ISRC are the same recording, so the closest one wins.
- **A different version is never chosen without an ISRC.** Live, remix, acoustic, instrumental, sped-up, slowed, remastered, radio edit, extended, demo, karaoke and a cappella are read only from a title's brackets or " - " suffix, so "Live Forever" isn't a live version. If only other versions exist, the result is `unavailable`, and they're listed for "Wrong version?". The plan didn't say whether they should be a low-confidence mapping; mapping them would play a wrong version with only a warning, so they aren't.
- **A different artist is a different recording too** (added by the matching tests card). A candidate whose primary artist isn't credited and doesn't look alike (under 10 of the 25 artist points) is never chosen without an ISRC: a cover, or Lionel Richie's "Hello" for Adele's. The tests found that such a candidate could still reach 50 and be kept as a low-confidence mapping. It's listed for "Wrong version?" with the reason `artist_mismatch`. A slightly different spelling ("Harbour" for "Harbor") still counts as the artist.
- **"Clean" is the explicit flag, not a version.** A "(Clean)" title counts as not explicit. When only the other explicit status is close, it's kept with an `explicit_conflict` warning and never matched automatically.
- **Credits:** "feat.", "ft." and "featuring" in a title are credits. "(with X)" is a credit only when X is one of the track's artists, so "Have a Baby (With Me)" keeps its title. Artist credits split at commas, `&`, "and", "feat." and "with", so "Delerium & Sarah McLachlan" and `['Delerium', 'Sarah McLachlan']` compare equal.
- **Normalization** keeps letters of every script, so non-Latin titles still compare, and folds ß, æ, ø and similar letters that accent stripping misses.
- **Ties break the same way every time:** ISRC match, no explicit conflict, same version, score, closer duration, then provider track id. Duplicate provider track ids count once. Candidates for other providers are ignored.
- **A host override always wins** (`method: 'override'`, confidence 100), even if the track isn't among today's candidates.

## 2026-11-24 · Provider adapter interfaces and mocks

- **The adapters follow API_CONTRACTS.md §5,** with the changes marked there: `getState` returns a `PlayerState` (one device's player) rather than the room's `PlaybackState`, `ConnectionState` keeps `isMock`, `ProviderTrack` gains `album`, and the error codes are listed.
- **Apple Music and Spotify are stubs that say "not in this build".** They connect to `not_in_this_build`, reject everything else with that code and claim no capability, so they can't pass for a working integration. Their cards replace them after a real-device test. The app keeps using the mocks.
- **Mocks claim no capability.** A mock plays no audio, so it reports `inAppAudio`, `backgroundPlayback`, `requiresExternalApp` and `autoplay` as `false`, and `isMock` as `true`. The old mock said Apple played inside q’d, which no mock does.
- **A player only takes its own provider's tracks** (`wrong_provider`). In mock mode the room player plays each fixture through the room's service, standing in for the provider track matching resolves later. This keeps the "plays through Apple Music" preview working.
- **Positions must be finite and not negative** (`invalid_argument`); fractional milliseconds are rounded.
- **Share links are parsed by hand,** not with `URL`, because React Native's `URL` lacks `hostname`, `pathname` and `searchParams` on some platforms. The mock catalog resolves a few made-up link ids to fixtures and says so; a real link to a song it doesn't have is `not_found`.
- **Mock results are copies,** so a caller can't change the catalog. Fixture tracks have no ISRC and aren't explicit, so nothing pretends to be real provider metadata.

## 2026-11-24 · Shared domain types and realtime events

- **Zod is a dependency now,** and `src/domain` may import it (ARCHITECTURE.md §4). The domain types card writes every shape in API_CONTRACTS.md §6 as a Zod schema and infers the TypeScript type from it, so the runtime check and the type can't drift apart.
- **A realtime payload that doesn't parse is ignored and triggers a refetch.** That covers a newer envelope `v`, an unknown event type, an event naming a different room than its channel, and any bad shape. The parsers never throw, and what they report for logging holds field paths and issue codes only, never values.
- **Schemas strip unknown fields** instead of rejecting them, so a new column or event field is additive and older clients keep working.
- **The card's "ProviderCapabilities" is `PlaybackCapabilities`** from API_CONTRACTS.md §5, with `ProviderCapabilities` as an alias. It lives in `src/domain` because the UI reads it.
- **Two `ProviderTrack` types exist for one branch.** `src/domain/recording.ts` has the contract's shape (`artists[]`, nullable ISRC). `src/providers/types.ts` still has the mocks' older shape; the provider adapters card moves the providers onto the domain type.

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

## 2026-11-24 · Settings: music services and account

- **Settings can disconnect a service** (PRODUCT_SPEC.md §3: connect, change and disconnect). In Settings a connected service shows **Disconnect** where the other screens show the Connected chip. Onboarding step 2 and Start a room still only connect. Disconnecting the service rooms play through hands "Play rooms through" to the other one, or hides it when none is left, so Start a room asks for a service again. Mock only: the real flow also has to revoke the provider authorization and remove the `provider_connections` row, which `API_CONTRACTS.md` doesn't cover yet. That's for the provider and RPC cards.
- **Only Apple Music and Spotify appear.** Figma's "YouTube Music · Ready" is illustrative copy, and tests check that no other service, "Ready" or "Soon" appears.
- **"Change your color" works.** It opens onboarding step 1's six swatches, and a pick is saved at once. "Done" closes them.
- **"Delete account" says it isn't available yet** instead of looking like a link that does nothing. Account deletion (PRODUCT_SPEC.md §7) needs Supabase and comes before the public beta.
- **A blank display name shows "You"** in the header while you type. As before, it isn't saved.
- A person still compares both tabs with Figma `20 · Mobile`.

## 2026-11-24 · Empty queue and unavailable song states

- **"Switch for next song" appears only when the host has connected the other service** (PRODUCT_SPEC.md §6). Without it, the 4.3 notice asks the host to skip ("Skip it to keep the room going.") and no longer offers a switch the host can't make. The button still does nothing; switching is the provider-switching card.
- **Listeners see the unavailable song too.** Their notice says the song isn't on the room's service, so the host's phone can't play it, and that the host can skip it. It has no buttons. Before, only the host saw anything.
- **An empty queue behind a playing song says so.** The Up next bar reads "Nothing queued yet" under "Up next · 0 songs", and the queue shows "The queue is empty". No autoplay is promised: the mock doesn't autoplay, and the real "Autoplay by …" label comes with the provider cards.
- The notice moved to `src/features/room/UnavailableNotice.tsx`. A person still compares 4.2 and 4.3 with Figma `20 · Mobile`.

## 2026-11-24 · Listeners: audit

- **Listeners shows who's in the room** (Figma 3.6): everyone by name, you marked "(you)", the host first with "Host · plays the music" and a Host chip, and everyone else "In the room". The host edits the rules and picks chosen people there; listeners read the rules as text. A person still compares it with Figma `20 · Mobile`.
- **The host's row names the service the room plays through.** It showed the host's sample service, so a room started through Apple Music still said Spotify.
- **"1 person in the room",** not "1 people".

## 2026-11-24 · Home: idle and live states

- **Idle (2.1)** is Home with no room: the greeting, Start a room, the code field and Recent rooms, with no mini player and no Live row. **Live (2.2)** is Home while you're in a room: that room's row says Live and "N listening now", and while a song plays the mini player sits at the foot of the screen. A room with nothing playing is still Live, without a mini player.
- **The Live row shows the room's name as it was started.** It showed the sample name, so a room started as "Friday Fade" read "Sunday Slow Burn" on Home while the mini player said "Friday Fade".
- **The mini player's Play/Pause is disabled** when the room's control rule leaves you out. Before, it looked active and did nothing.
- A person still compares both states with Figma `20 · Mobile`.

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

## 2026-11-20 · Join with a code on Home

- **The Join with a code screen (Figma 2.3, `/join`) is gone.** Baron asked for it. It was pushed as work in progress (`feat/join-from-home`) and finished in "Create room and join room screens" (2026-11-25). PLAN.md §6 still lists a "Join room" screen, so **a teammate should confirm** the removal. People type the code in Home's "Join with a code" field. Once all six characters are in, the arrow (or the keyboard's Go key) opens the room. There's no "Room found" preview step before it. Back from the room goes to Home.
- **Pasting a whole code works.** The field drops a pasted `QD-` prefix and anything that isn't a letter or digit (`src/domain/room-code.ts`), so `QD-7K4F9X` from a message lands as `7K4F9X`. The Join screen's "Paste from clipboard" chip went with the screen.
- **Mock mode.** A sample room's code opens that room. Any other complete code opens Kitchen Disco, as the Join screen did. The real `join_room_by_code` will say when a code doesn't exist. *(Replaced on 2026-11-25: the mock answers wrong codes with `code_invalid`.)*
- **Onboarding step 3.** "Join with a code" finishes onboarding on Home, where the code field is.
- **Copy.** The Join screen said guests don't need a music service. Welcome and onboarding step 2 still say it.
- **Figma** still has frame 2.3. It needs removing there too.

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
- **Step 3 finishes onboarding.** "Start a room" opens that screen with Home underneath, so Back goes Home. "Join with a code" and "I’ll do this later" go Home. *(Join with a code opened its own screen until 2026-11-20.)*
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
- **Room codes have six characters** (QD-7K4F9X), not four. The Join screen has six code boxes. *(The Join screen was removed on 2026-11-20; the code is entered on Home.)*
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
