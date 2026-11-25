# Decisions

Product and technical decisions that are not obvious from the code. Newest first.

## 2026-11-25 · Auth callback and session refresh

- **`/auth/callback` is open in every sign-in state.** Google and email links land there (`app/auth/callback.tsx`, thin; logic in `features/auth/useAuthCallback`). It exchanges the PKCE `code` once, then moves on to onboarding or Home. If the link is opened again after signing in, it still ends up there.
- **Every failure has its own words** and a way back ("Back to sign in", "Go to Welcome"): an expired link (`otp_expired`, `flow_state_expired`), one that can't be used (used already, opened on another device, bad state, nothing in it), a cancelled sign-in, and a failed exchange. In mock auth mode it says sign-in isn't set up in this build instead of pretending.
- **Email confirmation links open the callback.** Sign-up passes `emailRedirectTo` = `authRedirectUrl()`.
- **Startup waits for the stored session.** In live auth mode the session starts as `restoring`; the splash stays up and the navigator stays hidden until Supabase reports the stored session (`INITIAL_SESSION`) and the profile is read. A signed-in person never sees Welcome on restart; the route guards then send each start URL to the right group. Mock mode doesn't wait.
- **The session is restored from `expo-sqlite`'s `localStorage`**, not SecureStore, per "Supabase client and device storage" (2026-11-24). The card's "SecureStore" wording predates that decision.
- **An expired or revoked refresh token signs out.** supabase-js drops a session it can't refresh and reports `SIGNED_OUT`; `AuthSync` returns to Welcome, at startup or while the app is open. A network failure keeps the session, as supabase-js does.
- **Refresh follows the app state** (unchanged from the Supabase client card): `startAutoRefresh` in the foreground, `stopAutoRefresh` in the background, tested in `src/services/supabase.test.ts`.
- **Known risk:** a profile read that fails at startup (offline) sends a finished account to onboarding, because a failed read counts as unfinished.

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
