# Decisions

Product and technical decisions that are not obvious from the code. Newest first.

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
