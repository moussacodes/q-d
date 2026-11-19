# q’d

**Different apps. One aux.**

q’d is a collaborative music-room app for people who use different streaming services. Friends join a room, contribute recordings to one shared queue, and the host plays the queue through a connected music provider.

The December 4, 2026 prototype focuses on **aux mode**: everyone collaborates while one host device plays. **sync (beta)**—independent playback on selected participants’ devices—is a later private research milestone subject to provider and licensing approval.

## Demo scope

- Sign in with Apple, Google, or email
- Create or join a room with a six-character code or secure QR invitation
- Let guests join and add songs without connecting a music provider
- Search a canonical catalog and add recordings to a live shared queue
- Play from the host’s connected Apple Music or Spotify account
- Keep Apple Music playing when the host locks their iPhone
- Show honest unavailable, reconnecting, and provider-switch states

## Product boundaries

- q’d coordinates metadata, room state, queues, and playback commands; it never relays, downloads, rebroadcasts, or mixes provider audio.
- Apple Music and Spotify are the only planned demo providers.
- Spotify access remains limited to approved private development users until the platform grants broader access.
- Public `sync (beta)` is blocked pending written provider clarification and legal review.
- YouTube Music, TIDAL, Amazon Music, and Deezer are not represented as available integrations.

## Design

Implementation follows only the **`20 · Mobile`** page in the [q’d Figma design file](https://www.figma.com/design/HzChKn1M0FH1ueyOY7zIUQ/q-d-%E2%80%94-Design-Directions?node-id=68-1420&p=f).

The original pitch is available at [docs/pitch/q-d-pitch-deck.pdf](docs/pitch/q-d-pitch-deck.pdf).

## Stack

- Expo SDK 58, React Native, Expo Router, and strict TypeScript
- Supabase Auth, Postgres, Row Level Security, Realtime, and Edge Functions
- A local Swift Expo module for MusicKit
- Provider adapters for Apple Music, Spotify, and deterministic mocks
- Jest, React Native Testing Library, Supabase integration tests, and Maestro

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains each piece, where its code lives, and why.

## Repository status

The app shell is in place: design tokens, core components, and every screen as a navigable shell running on mock data. Supabase, the music providers, and the quality gates come next. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) marks each part as **Built** or **Planned**.

## Setup

Everything currently runs on deterministic mock data, so no accounts, keys, or `.env` file are needed yet. The environment-validation card adds `.env.example` when Supabase arrives.

### Everyone

You need Git, **Node 22.13 or newer** (Node 24 works), and npm. To try the app on a phone, install **Expo Go** from the App Store or Play Store. It must support Expo SDK 58. If Expo Go says the project is incompatible, update it or use the web preview.

```bash
git clone https://github.com/moussacodes/q-d.git
cd q-d
npm ci
npm start
```

- **On a phone:** scan the QR code from `npm start`. On iPhone, use the Camera app. On Android, use the scanner in Expo Go. The phone and the computer must be on the same Wi‑Fi. If they can't reach each other, run `npx expo start --tunnel`.
- **In a browser:** `npm run web`.
- **Every screen at once:** in development, the Welcome screen has a **Screens** button. It opens `/dev`, which lists every screen and state with its Figma number. `/dev/components` is the component gallery.
- **Before pushing:** `npm run check` runs the typecheck, lint, format check and tests. CI runs the same checks, plus Expo Doctor, on every pull request. `npm run format` fixes formatting.

### Windows (Baron)

- Install Node LTS from [nodejs.org](https://nodejs.org) or with nvm-windows. PowerShell and Git Bash both work.
- When Windows Firewall asks about Node, allow it on **private** networks, so your phone can reach the Metro server.
- Windows can't build iOS apps. Use Expo Go on your iPhone and the web preview for everything. Native work (MusicKit, the Spotify SDK, development builds) happens on the Mac.
- Android isn't configured yet, so there's no emulator setup to do.

### Mac (Moussa)

- Install Node with Homebrew or nvm, and install Xcode 27.2. The Xcode 27.3 beta can sit beside it for beta-iOS testing. Open Xcode once to accept the license and install the iOS Simulator.
- `npm run ios` opens the app in Expo Go in the iOS Simulator.
- MusicKit and the Spotify SDK need a **development build** on a **physical iPhone**. Expo Go can't load them. That workflow starts with the EAS profiles and `qd-music-kit` cards. Until then there's nothing native to build.
- Never commit the generated `ios/` folder. Native settings live in `app.config.ts` and config plugins.

## Docs

| Document | What's in it |
|---|---|
| [PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) | What q’d does, its rules, and the claims it never makes |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it's built, the boundaries, and why each exists |
| [API_CONTRACTS.md](docs/API_CONTRACTS.md) | RPC functions, realtime events, provider adapters, and shared types |
| [PROVIDER_FEASIBILITY.md](docs/PROVIDER_FEASIBILITY.md) | What Apple Music and Spotify allow, and the risks |
| [DECISIONS.md](docs/DECISIONS.md) | Decisions log, newest first |
| [LEARNING_PATH.md](docs/LEARNING_PATH.md) | What to learn, in what order, and the "what we learned" log |
| [DEMO_RUNBOOK.md](docs/DEMO_RUNBOOK.md) | The Dec 4 demo script, checklists, and fallbacks |

## Team workflow

Claude Code and Codex work on separate branches. One acts as builder and the other as reviewer for each milestone; neither merges its own work without review. Each Forge Trello card gets one branch and one PR. The full agent rules are in [AGENTS.md](AGENTS.md), and [CLAUDE.md](CLAUDE.md) imports the same file.

## License

No open-source license has been granted at this stage. All rights are reserved by the project authors.
