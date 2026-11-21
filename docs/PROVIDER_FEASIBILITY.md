# Provider feasibility

What each music service lets q’d do, what it requires, and what could block the demo or the beta. Provider rules change often. **Before any public release, re-check every source below against the official documentation** and update this file.

Last checked: **2026-11-19**. Nothing here has been confirmed on a real device yet. Items marked **Verify on device** are expected behavior that still needs a test.

## Summary

| Service | Demo role | How q’d talks to it | Main constraint | Status |
|---|---|---|---|---|
| **Apple Music** | Host playback (primary), canonical catalog | MusicKit, through the local Swift module `modules/qd-music-kit` | Needs a Mac, Xcode, a development build and an Apple Developer membership. The host needs an Apple Music subscription. | Planned · Nov 28–30 |
| **Spotify** | Host playback | Spotify iOS SDK (App Remote) controls the Spotify app, and the Web API handles search and metadata | Development mode allows 5 users, the app owner needs Premium, and the endpoint set is reduced. Public use needs Spotify's approval. | Planned · Nov 25–27 |
| **Mock** | Development, tests, demo fallback | Deterministic in-app adapters | Must always be labeled as a mock | Planned · adapters card |
| YouTube Music | None | — | No official API | Not supported |
| TIDAL, Deezer, Amazon Music | None | — | Not evaluated | Future |

## Apple Music

**How it works in q’d.** The host's iPhone plays inside q’d with MusicKit's `ApplicationMusicPlayer`. The player belongs to q’d, so q’d controls the queue and reads its state directly. The background-audio mode keeps playback going with the screen locked.

**Requirements**

- A paid Apple Developer Program membership and the MusicKit App Service enabled for the bundle ID `app.qd.mobile`. MusicKit generates the developer token automatically for apps with this service enabled.
- The `audio` background mode in the app config (through the qd-music-kit config plugin).
- A custom development build. Expo Go can't load MusicKit.
- A Mac with Xcode to build, and a physical iPhone to test. Moussa owns this work.
- Each user authorizes q’d to use Apple Music. Without an Apple Music subscription, MusicKit can only reach music the user bought or synced, so in practice the host needs a subscription.

**What we may do with artwork.** Apple supplies a background color for artwork, and q’d may use it for the Now playing palette. Don't analyze, crop or overlay artwork beyond what Apple allows.

**Risks**

- The demo depends on the Mac and on Moussa's time (Nov 28–30 milestone).
- Playback limited to previews instead of full tracks has been reported when the user token isn't in place. **Verify on device** that a subscribed host gets full tracks.
- Lock-screen and background playback behavior. **Verify on device.**
- The demo plan tests a stable-iOS host and an iOS 27.3 beta participant, so beta-OS bugs are possible on the participant's phone.

## Spotify

**How it works in q’d.** q’d is a remote control. The host's Spotify app plays the audio, and q’d tells it what to play through App Remote (on-device) and the Web API. q’d never streams or relays Spotify audio, and the copy must never suggest it does.

**Requirements**

- A registered Spotify app with a client ID. Any client secret stays on the server (Edge Function secrets), never in the app.
- The Spotify app installed on the host's phone. The Spotify iOS SDK needs a physical device, because Spotify can't be installed on a simulator.
- **Premium for the host.** App Remote can control playback for free users, but playing a specific track on demand by URI requires Premium. q’d queues specific tracks, so the host needs Premium.
- **Development mode limits** (Spotify's February 2026 changes, applied to all existing development-mode apps from March 9, 2026):
  - The app owner must have an active Premium subscription, or the app stops working.
  - One development-mode client ID per developer.
  - Up to **five authorized users** per client ID. Each must be added by hand in the Spotify dashboard.
  - Access to a reduced set of Web API endpoints.
- Wider access needs Spotify's extended-quota approval. Until then, Spotify stays limited to the five development users, including in the public beta.

**Playlist import.** In development mode, playlist contents are only available when the connected user owns or collaborates on the playlist. q’d must not promise import of any public Spotify link.

**Policy.** Spotify's Developer Policy restricts synchronized playback across devices, so public `sync (beta)` with Spotify stays blocked.

**Risks**

- A developer reported App Remote authentication failing with `unknown_error` on SDK 5.0.1 with a recent Spotify app, and the report hasn't been resolved. **Verify on device** early (Nov 25–27).
- An endpoint q’d needs may not be in the reduced development-mode set. Check each Web API call against the February 2026 changelog when the Spotify card starts.
- Spotify may suspend or limit control when the Spotify app is backgrounded or idle. The demo keeps q’d in the foreground.

## Mock provider

- Deterministic catalog and playback adapters that implement the same interfaces as Apple and Spotify.
- Used for web and Windows development, UI work, automated tests and as the labeled demo fallback.
- Feature flags pick a real or mock adapter. A mock is always labeled in the UI and never presented as a live integration.

## YouTube Music, TIDAL, Deezer, Amazon Music

- **YouTube Music** has no official API for playback or library control. Using it would require scraping or private APIs, which q’d doesn't do. Not supported.
- **TIDAL, Deezer, Amazon Music** haven't been evaluated. They're future or unavailable and must not appear as "Ready" or "Soon" in the app.

The pitch deck shows all five services. That was the vision at pitch time, not a commitment.

## Matching across services

The same song has a different ID on every service, so q’d stores one canonical recording and maps it to each service's track. ISRC (the International Standard Recording Code) is the strongest link, and Apple and Spotify both expose it on tracks. Where ISRC is missing or differs, q’d falls back to the deterministic scoring rules in [PRODUCT_SPEC.md § 6](PRODUCT_SPEC.md#6-catalog-and-matching).

Spotify's February 2026 changelog listed track `external_ids` (where the ISRC lives) as removed, and the March 2026 changelog reversed that, so the ISRC is still returned. `available_markets`, `linked_from` and `popularity` stay removed in development mode. q’d therefore can't read a track's markets to decide availability. Ask for the U.S. market in the request instead.

## Release gate

- **Dec 1:** the provider release gate decides, for each real provider, whether it's stable enough for the demo. The test is the two-phone integration run on a normal network and on the venue network.
- **Dec 2:** feature freeze. If either real provider is unstable, the demo uses one real provider plus a clearly labeled mock for the other. See [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md).
- **Before public beta:** re-read every source below. Any provider or API policy change triggers a fresh review.

## Similar products

These show that the idea has demand, but none of them proves that q’d gets the same API access or licensing rights:

- **Stationhead** shows demand for listening connected to people's own services.
- **JamShare** shows that converting song links between services works.
- **Listen Together** shows the room experience with one controllable source.

## Sources

- [Spotify: February 2026 Web API development mode changes, migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
- [Spotify: Web API changelog, February 2026](https://developer.spotify.com/documentation/web-api/references/changes/february-2026) and [March 2026](https://developer.spotify.com/documentation/web-api/references/changes/march-2026)
- [Spotify: Update on developer access and platform security (blog, 2026-02-06)](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security)
- [Spotify: Get playlist items](https://developer.spotify.com/documentation/web-api/reference/get-playlists-items)
- [Spotify: iOS SDK](https://developer.spotify.com/documentation/ios) and [iOS SDK on GitHub](https://github.com/spotify/ios-sdk)
- [Spotify: Developer Policy](https://developer.spotify.com/policy)
- [Spotify community: App Remote `unknown_error` report](https://community.spotify.com/t5/Spotify-for-Developers/Spotify-iOS-SDK-5-0-1-App-Remote-Authentication-Returns-error/td-p/7482095)
- [Apple: MusicKit](https://developer.apple.com/musickit/) and [MusicKit documentation](https://developer.apple.com/documentation/musickit)
- [Apple: Using automatic token generation for Apple Music API](https://developer.apple.com/documentation/musickit/using-automatic-token-generation-for-apple-music-api)
- [Apple: App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Expo: Adding custom native code](https://docs.expo.dev/workflow/customizing/)
