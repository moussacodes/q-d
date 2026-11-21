# q’d product spec

What q’d does, who it's for, and the rules the app follows. This file is the product source of truth in the repository. When a rule changes, update this file and add an entry to [DECISIONS.md](DECISIONS.md).

Related: [ARCHITECTURE.md](ARCHITECTURE.md) explains how it's built. [PROVIDER_FEASIBILITY.md](PROVIDER_FEASIBILITY.md) explains what Apple Music and Spotify allow.

## 1. The product

**Different apps. One aux. Everyone else just listens.**

Friends rarely use the same music app. q’d gives them one shared queue anyway. Everyone joins a room and adds songs, whatever service they use or even with no service at all. The host's phone plays the queue through the host's own Apple Music or Spotify account.

q’d coordinates metadata, room state, the queue and playback commands. It never relays, downloads, rebroadcasts or mixes provider audio.

### People in a room

| Role | Who | Needs a music service? |
|---|---|---|
| **Host** | Started the room. Their phone plays the music. | Yes. Apple Music or Spotify, connected before the room starts. |
| **Listener** | Joined with a code or QR invite. Adds songs. | No. |

Everyone needs a q’d account, but only the device that plays needs a music service.

### Modes

- **`aux`** is the default and the only mode in the demo and the public beta. One host device plays, and everyone collaborates on the queue.
- **`sync (beta)`** is private research for after the demo. In sync, 2–15 selected devices play the same queue independently, each through its own service. It stays hidden behind a feature flag until providers and a legal review approve it in writing. Details are in [Sync (beta)](#10-sync-beta-post-demo-research).

## 2. Scope

| Phase | Date | What ships |
|---|---|---|
| **Demo** | Dec 4, 2026 | A 3–5 minute `aux` demonstration on iPhones. See [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md). |
| **Public beta** | After the demo | The demo feature set plus safety, privacy and account deletion. See [§11](#11-public-beta). |
| **Post-demo** | After the demo | Playlist-link import (first), chosen people, join approval, guest skip, host transfer, `sync (beta)` research. |

### Demo must-haves

1. Sign in with Apple, Google or email.
2. Create or join a room with a six-character code or a QR invitation.
3. Guests join and add songs without connecting a music service.
4. Search a catalog and add recordings to a live shared queue.
5. Both phones see queue changes within two seconds on normal Wi‑Fi.
6. The host plays the queue through Apple Music or Spotify.
7. Apple Music keeps playing when the host locks their iPhone.
8. Honest states for unavailable songs, a reconnecting host and switching services.

### Non-goals

These are out of scope for the demo and the beta. Don't build them without a decision entry.

- Chat, reactions, payments or advertising.
- AI song matching. Matching is deterministic (§6).
- Relaying, rebroadcasting, downloading or mixing audio.
- Scraping, private APIs or other hidden provider workarounds.
- YouTube Music, TIDAL, Amazon Music or Deezer. They're future or unavailable (see [PROVIDER_FEASIBILITY.md](PROVIDER_FEASIBILITY.md)).
- An Android release. The app config leaves Android out for now, and when Android work starts is still undecided.

## 3. Accounts and onboarding

- A q’d account is required for everyone.
- Apple, Google and email/password sign-in all work by demo day.
- q’d sign-in is separate from music-service authorization. Signing in with Apple doesn't connect Apple Music.
- Onboarding has three steps:
  1. **Your name.** Display name, avatar color and an 18+ confirmation.
  2. **Music services.** Connecting Apple Music or Spotify is optional here and can be skipped.
  3. **Start or join.** Start a room or join one.
- A music service becomes required only when this device is about to play:
  - when starting an `aux` room (the host plays), and
  - when claiming a `sync (beta)` playback slot (post-demo).
- Settings can connect, change and disconnect services.

## 4. Rooms

### Creating and joining

- The default mode is `aux`. The default rule is that everyone can add songs.
- A room holds up to **15 signed-in participants**, including the host.
- **Room codes** have six characters and are shown as `QD-7K4F9X`.
  - Joining by code requires sign-in.
  - Codes expire, are checked for collisions, and have strict attempt limits per user and per IP address.
- **QR invitations** use a separate high-entropy token, never the short room code, so a QR code can't be guessed from the room code or the other way round.
- Ended-room history is kept for 90 days.

### Who can do what

| Action | Host | Listener |
|---|---|---|
| Add songs | ✓ | ✓ |
| Play, pause, seek | ✓ | |
| Skip | ✓ | |
| Remove a song | ✓ | |
| Reorder the queue | ✓ | |
| End the room | ✓ | |
| Remove a person (beta) | ✓ | |

These rules are fixed for the demo. "Chosen people", "Ask before people join", per-person skip and automatic host transfer are post-demo.

### When the host disappears

1. Everyone sees **"Host reconnecting"** for 30 seconds.
2. If the host doesn't return, playback pauses. The room and the queue are kept.
3. A returning host resynchronizes room state before resuming.

## 5. The queue

- When several people add songs at once, the server assigns each one its position. Clients never decide positions.
- Every add carries an idempotency key, so a retry never adds the same song twice.
- If a recording is already in the queue, the app shows **"Already in queue"** and asks the user to confirm before adding it again.
- Queue entries can belong to a batch (`batchId`), so playlist import (§8) fits without a redesign.
- When the queue runs out in `aux`, the host's service may keep playing on autoplay. q’d labels it **"Autoplay by Apple Music"** or **"Autoplay by Spotify"**.
- Provider autoplay is turned off in `sync (beta)`, because each service would choose different songs.

## 6. Catalog and matching

The same song has a different ID on every service, so q’d keeps one **canonical recording** and maps it to each provider's track.

- Apple's catalog is the canonical search source, including for people with no music service connected.
- Provider-specific mappings are resolved when playback needs them.

Matching is deterministic:

1. An exact ISRC match is the strongest signal.
2. Text is normalized for case, punctuation, accents, `&`/`and` and featured-artist formatting.
3. Candidates are scored on title, primary artist, duration, album, explicit status and version markers.
4. Live, remix, acoustic, instrumental, sped-up, slowed, clean and remastered versions are different recordings, unless an exact ISRC match proves otherwise.
5. An automatic match needs at least 90/100 confidence and a clear lead over the second-best result.
6. An explicit/clean conflict always blocks an automatic match.
7. Low-confidence items keep their provider-specific mapping and show a warning.
8. The host can tap **"Wrong version?"** to pick the right one. Overrides are stored and audited.

### Song not on the host's service

If a queued song isn't available on the service the host's phone plays through:

- If it's on another service the host has connected, the host is asked whether to switch services for that song or skip it. q’d never switches on its own.
- Otherwise the song shows as unavailable and the host skips it.
- Services only change between songs, never in the middle of one.

## 7. Privacy and safety

- Logs and analytics never contain credentials, emails, room codes or listening history.
- Analytics are opt-in, kept for 90 days, and never include provider or song data.
- There's no session replay and no automatic event capture.
- Crash reports are privacy-filtered.
- The public beta adds reporting, blocking, host removal, display-name filtering and a 48-hour review workflow.

### Account deletion

1. Requires signing in again and an explicit confirmation.
2. Ends any room the user is hosting.
3. Revokes the q’d login and every music-service authorization.
4. Deletes the profile, provider credentials, memberships, analytics identity and the Supabase auth record.
5. In shared-room history that is kept, the person's name is replaced with **"Deleted user"**, and every identifying link is removed.
6. Cleanup finishes within 24 hours, with retries.
7. The same email, Apple ID or Google account can later create a completely new account. No history or connections come back.

## 8. Playlist-link import (post-demo)

This is the first feature after the demo. The queue supports batches from the start, so it needs no schema redesign.

1. Paste an Apple Music or Spotify playlist link.
2. q’d detects the provider and checks access.
3. A preview shows the playlist name, item count, exact matches, uncertain matches, unavailable items and the 50-song limit.
4. The user confirms before the queue changes.
5. Usable recordings are added in their original order under one `batchId`.
6. The result shows skipped and unmatched totals, and the host can undo the whole batch.
7. Only one import runs per room at a time.
8. Permission follows the room's normal "who can add songs" rule.

Spotify only exposes a playlist's contents when the connected user owns or collaborates on it. q’d must not promise import of any public Spotify link.

## 9. Words we use and claims we never make

The product name is **q’d**, with a curly apostrophe, in everything people see. Code, URLs and identifiers use `qd` or `q-d`. The iOS bundle ID is `app.qd.mobile`.

In `aux`, the copy says that **the host's phone plays the music** and that **guests don't need a music service**.

q’d never says or implies that:

- it streams Spotify audio itself (it remote-controls the Spotify app),
- everyone hears the music on their own service, or that people are "in sync" (that's `sync (beta)`, which isn't public),
- synchronization is sample-perfect, even in `sync (beta)`,
- YouTube Music, TIDAL, Amazon Music or Deezer are available or "coming soon",
- a mock provider is a real integration,
- an integration works before it has been tested on a real device.

Public copy for `sync (beta)`, once it's allowed, must say that brief drift can occur.

## 10. Sync (beta) (post-demo research)

- 2–15 selected devices play independently, each through its own service.
- The host always holds playback slot 1. People without a slot still take part but get no audio from q’d.
- It targets remote or headphone listening. Small delays between nearby speakers would cause echoes.
- Drift under about 750 ms is acceptable. Corrections start when drift goes over about one second.
- Public sync is blocked until providers and a legal review approve it in writing. Spotify's Developer Policy currently blocks it.

The technical design is in [ARCHITECTURE.md § Sync (beta) research](ARCHITECTURE.md#sync-beta-research).

## 11. Public beta

- A public TestFlight link with up to 100 testers.
- U.S. only, 18+.
- Free and ad-free.
- Apple-first and `aux` only.
- Rooms of up to 15 signed-in participants. Ended-room history kept for 90 days.
- Reporting, blocking, name filtering, account deletion, a privacy policy, terms and community rules. The policy, terms, rules and support pages are hosted on GitHub Pages.
- A clean production Supabase project, separate from demo data.
- A dedicated support mailbox. Try `support.qdapp@gmail.com` first, then `support.qdmusicapp@gmail.com`.
- Spotify stays limited to the five development-mode users until Spotify approves wider access.
- `sync (beta)` stays behind a private feature flag.

## 12. Screens

The visual source is the Figma page [`20 · Mobile`](https://www.figma.com/design/HzChKn1M0FH1ueyOY7zIUQ/q-d-%E2%80%94-Design-Directions?node-id=68-1420&p=f) only. It's an initial direction. Where it conflicts with this spec, this spec wins, and each change is listed in [DECISIONS.md](DECISIONS.md).

Numbers match the Figma page and the in-app screen index at `/dev`.

| # | Screen | Route |
|---|---|---|
| 1.1 | Welcome | `/` |
| 1.2 | Sign in | `/sign-in` |
| — | Create account | `/create-account` |
| 1.3 | Onboarding 1 · Your name | `/onboarding/name` |
| 1.4 | Onboarding 2 · Music services | `/onboarding/services` |
| 1.5 | Onboarding 3 · Start or join | `/onboarding/start` |
| 2.1 / 2.2 | Home · nothing playing / room playing | `/home` |
| 2.3 | Join with a code | `/join` |
| 2.4 | Start a room | `/create-room` |
| 3.1 | Room | `/room/[code]` |
| 3.3 | Up next | `/room/[code]/queue` |
| 3.4 | Add a song | `/room/[code]/add-song` |
| 3.5 | Invite people | `/room/[code]/invite` |
| 3.6 | Listeners | `/room/[code]/listeners` |
| 4.1–4.3 | Listener view, empty queue, song not on host's service | `/room/[code]?view=…` |
| 5.1 / 5.2 | Settings · music services / account | `/settings` |

## 13. Open questions

These questions are still open. Record each answer in [DECISIONS.md](DECISIONS.md).

- **Android.** The app has to work in both the App Store and the Play Store eventually. When Android work starts (demo, beta or later) is undecided.
- **Room codes.** How long a code stays valid, the exact attempt limits, and the character set (for example, whether look-alike characters such as `0`/`O` and `1`/`I` are left out).
- **Expo owner.** Which Expo account slug owns the project (`owner` in `app.config.ts`).
- **Catalog search for guests.** Where Apple catalog search runs for people without Apple Music, and on Android or the web. See [ARCHITECTURE.md § Open technical decisions](ARCHITECTURE.md#open-technical-decisions).
