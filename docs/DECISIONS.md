# Decisions

Product and technical decisions that are not obvious from the code. Newest first.

## 2026-11-19 · Mock-data development mode

- **One switch, `EXPO_PUBLIC_DATA_MODE`.** `mock` is the only mode that exists until Supabase and the real providers land, so any other value falls back to `mock` with a warning (`src/services/dataMode.ts`).
- **Mock is always labeled.** In mock mode a strip under the status bar reads "Mock data · nothing here is live". Mock music-service connections say "Mock connection · no Spotify account used" instead of an account name. Mock data is never shown as a live integration.
- **Mock adapters implement the plan's interfaces.** `src/providers/types.ts` holds `CatalogAdapter` and `PlaybackAdapter` from plan.md §3, trimmed to what the mocks need. `ConnectionState.isMock` lets the UI tell a mock connection from a real one. The provider-adapter card extends these instead of starting over.
- **The mock player keeps real time.** Rooms open at 1:40 into the song, like the Figma frames. Progress advances, the host can pause and play, and when a song ends the next queued song plays. Home's mini player and the room share one player per room, so they always agree.
- **Mock search is deterministic.** Every word of the query has to match the title, artist or album, ignoring case, accents and punctuation. Results keep a fixed order.
- **Runs on Windows.** `npm run web` (or `npx expo start` for Expo Go) works with no Mac, backend or provider accounts.

## 2026-11-19 · Screen shells

The Figma page `20 · Mobile` is an initial direction. Where it conflicts with plan.md, the plan wins (team decision, 2026-11-19). The shells keep the Figma layout and change only what's below.

- **Aux mode, not sync.** The Figma room screens assume everyone listens on their own service. The demo is aux: only the host's phone plays.
  - Removed **Resync**. The room strip now says "N in the room" instead of "5 of 6 in sync".
  - Listeners see the host chip, and the host sees an **Invite** chip.
  - Copy now says the host's phone plays the music, and that guests don't need a music service: Welcome, onboarding step 2, Join, Invite, empty room and Add a song.
  - **4.3 "Not on your service"** is shown from the host's side. The song isn't on the service the host's phone plays through, so the host can skip it or switch services for the next song (plan.md §2). A listener no longer "sits it out".
  - Settings no longer has "When a song isn't on your service" (Play via YouTube Music / Sit it out).
- **Room codes have six characters** (QD-7K4F9X), not four. The Join screen has six code boxes.
- **Demo room rules are fixed.**
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
