# qd-music-kit

q’d's local Expo module around MusicKit. The Swift side (`ios/`) is Moussa's: it needs a Mac, Xcode and a development build. Windows work changes only the TypeScript wrapper (`src/QdMusicKit.ts`, `src/QdMusicKit.types.ts`) and the config plugin (`app.plugin.js`). See docs/ARCHITECTURE.md §4.8.

Without the native module (Expo Go, web, Android, Jest) the wrapper reports `unavailable`. A native method the Swift side doesn't have yet makes its wrapper call throw `not_implemented`, so the app says "needs the q’d app build" instead of pretending.

## Native methods the Swift side still needs

The TypeScript wrapper already calls these. Each is an `AsyncFunction` on `QdMusicKitModule` with exactly this name and return shape. Until one exists, the app treats Apple Music as not available in this build.

### Apple Music connection (card "Apple Music connection")

| Method | MusicKit | Returns |
|---|---|---|
| `authorizationStatus` | `MusicAuthorization.currentStatus` (never prompts) | `"authorized"`, `"denied"`, `"restricted"` or `"notDetermined"` |
| `requestAuthorization` | `await MusicAuthorization.request()` (prompts once; later calls return the saved answer) | same strings |
| `subscriptionStatus` | `try await MusicSubscription.current` | `{ canPlayCatalogContent: Bool, canBecomeSubscriber: Bool }` |
| `storefront` | `try await MusicDataRequest.currentCountryCode` | the two-letter code, e.g. `"us"` (any case) |

Throw from `subscriptionStatus` and `storefront` when MusicKit throws (offline, for example). The wrapper reports it as `native_error`, which the app treats as "couldn't reach Apple Music" and keeps the account's connection row.

`connect` can stay as it is: the app's Apple connection uses the four methods above, not `connect`.
