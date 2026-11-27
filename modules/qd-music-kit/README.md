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

### Apple Music playback (card "Apple playback adapter (aux)")

The existing stubs (`capabilities`, `prepare`, `play`, `pause`, `seek`, `enqueue`, `getState`, `disconnect`) keep their names and arguments. What the TypeScript side now expects from them:

- **`capabilities`**: report `inAppAudio: true` and `backgroundPlayback: true` only once they're verified on an iPhone (background with the screen locked). Report `autoplay: true` only if `ApplicationMusicPlayer` keeps playing songs it picked itself after the queue ends, and the state below marks them.
- **`prepare(trackId, startPositionMs)`**: load the catalog song (`MusicCatalogResourceRequest<Song>` by id) into `ApplicationMusicPlayer.shared.queue`, seek to the start, don't play. `play`/`pause`/`seek(positionMs)`/`enqueue(trackIds)` map to the player (`enqueue` appends with `queue.insert(…, position: .tail)`). `disconnect` stops and clears the queue.
- **`getState`** returns `{ status: "playing" | "paused" | "stopped", providerTrackId, positionMs }`, plus, for a song q’d didn't queue, `autoplay: true` and `metadata: { title, artists: [String], album, durationMs, isrc, explicit, artworkUrl, artworkBackgroundColor }` (artwork color from `Artwork.backgroundColor` as `#rrggbb`). Without `autoplay` and `metadata`, a song q’d didn't queue is treated as the end of the room's song.
- **Event `onPlayerStateChange`** (declare `Events("onPlayerStateChange")`, send the same shape as `getState`) when the status or song changes, including lock-screen and Control Center play/pause. Optional: the app also polls `getState`.
- **Error codes** to throw: `ERR_QD_NOT_AUTHORIZED` (MusicKit access not granted), `ERR_QD_NOT_SUBSCRIBED` (no subscription; catalog songs can't play), `ERR_QD_UNAVAILABLE_IN_STOREFRONT` (the song isn't playable in this storefront), `ERR_QD_NOT_FOUND` (no catalog song with that id). Anything else is reported as "couldn't reach Apple Music". Don't put song titles or account details in error messages; the app drops them anyway. Throw them the way the skeleton's `notImplemented` does, as `Exception(name:description:code:)` with the code string above: the wrapper reads only the error's `code`.
- **Units and types**: every position (`startPositionMs`, `seek`'s `positionMs`, `getState`'s `positionMs`) and `durationMs` is milliseconds as a `Double` (MusicKit's `playbackTime` is seconds, so multiply by 1000). Track ids are Apple Music catalog song ids as strings. `capabilities` stays a synchronous `Function` returning `[String: Bool]`.
