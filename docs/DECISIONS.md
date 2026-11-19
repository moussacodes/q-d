# Decisions

Product and technical decisions that are not obvious from the code. Newest first.

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
