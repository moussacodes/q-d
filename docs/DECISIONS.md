# Decisions

Product and technical decisions that are not obvious from the code. Newest first.

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
