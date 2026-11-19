# Learning path

q’d is a learning project as much as a product. The agents write a lot of the code, but Moussa and Baron have to understand every part well enough to explain it, review it and demo it. This file is the plan for that.

## The loop for each milestone

1. **Read** one short concept guide from the list below before starting.
2. **Build** one vertical slice, for example "add a song" from the button all the way to Postgres and back.
3. **Explain** the data flow to your teammate without the agent's help. If you can't, that's the next thing to read.
4. **Review** the diff together before it merges.
5. **Write** a short "what we learned" entry at the bottom of this file.
6. **Swap** builder and reviewer roles, where the hardware allows it (Mac-only work stays with Moussa).

## Learning order

Each topic says why it matters here and where it shows up in the repository.

### 1. Git, branches, commits, pull requests

- **Why here:** one Trello card is one branch is one PR. Two people and two agents share the repo, and nobody merges their own work.
- **In the repo:** `AGENTS.md` (workflow), the branch history (`feat/bootstrap` → `feat/design-tokens` → `feat/screen-shells`).
- **Read:** [Pro Git, chapters 2–3](https://git-scm.com/book/en/v2), [GitHub: About pull requests](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-pull-requests)

### 2. TypeScript and React fundamentals

- **Why here:** everything in `src/` is strict TypeScript. Components, props, state and context are the building blocks of every screen.
- **In the repo:** `src/design/theme.tsx` (context), `src/components/controls.tsx` (props and variants), `src/features/session/MockSession.tsx` (state).
- **Read:** [React: Learn](https://react.dev/learn), [TypeScript handbook](https://www.typescriptlang.org/docs/handbook/intro.html)

### 3. React Native and Expo Router

- **Why here:** screens are files in `app/`, and modal sheets are routes. Layout uses `StyleSheet` and design tokens.
- **In the repo:** `app/_layout.tsx` (root stack and modal sheets), `app/room/[code]/` (dynamic routes), `src/components/layout.tsx` (`Screen`, safe areas).
- **Read:** [React Native: Core components](https://reactnative.dev/docs/intro-react-native-components), [Expo Router introduction](https://docs.expo.dev/router/introduction/)

### 4. Supabase: SQL, migrations, RLS, Realtime, Auth

- **Why here:** Postgres is the source of truth. RLS is the security model. RPC functions make queue changes safe when several people act at once. Realtime keeps phones fresh.
- **In the repo:** `supabase/` (planned), [ARCHITECTURE.md § 4.10](ARCHITECTURE.md#410-client-vs-server-authority), [API_CONTRACTS.md](API_CONTRACTS.md).
- **Read:** [Database functions](https://supabase.com/docs/guides/database/functions), [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security), [Realtime](https://supabase.com/docs/guides/realtime), [Auth](https://supabase.com/docs/guides/auth)

### 5. OAuth, provider tokens, scopes and secure storage

- **Why here:** q’d sign-in and music-service authorization are separate flows. Provider tokens live in SecureStore on the device, and never in the database or the logs.
- **In the repo:** [ARCHITECTURE.md § 4.11](ARCHITECTURE.md#411-qd-sign-in-vs-music-service-authorization), [PROVIDER_FEASIBILITY.md](PROVIDER_FEASIBILITY.md).
- **Read:** [RFC 8252: OAuth for native apps](https://datatracker.ietf.org/doc/html/rfc8252) (sections 1–8), [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), [Spotify authorization](https://developer.spotify.com/documentation/web-api/concepts/authorization)

### 6. Swift, Expo Modules, MusicKit, iOS background audio

- **Why here:** Apple Music plays inside q’d through a local Swift module, and it has to keep playing with the screen locked. Mac only, so this is Moussa's.
- **In the repo:** `modules/qd-music-kit` (planned), [ARCHITECTURE.md § 4.8](ARCHITECTURE.md#48-native-module-modulesqd-music-kit).
- **Read:** [Expo Modules API](https://docs.expo.dev/modules/overview/), [MusicKit](https://developer.apple.com/documentation/musickit), [Swift tour](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/guidedtour/)

### 7. Distributed playback: clocks, latency, drift, failure recovery

- **Why here:** "Host reconnecting", listener progress estimates and the post-demo `sync (beta)` research all depend on reasoning about time across devices.
- **In the repo:** [ARCHITECTURE.md § Sync (beta) research](ARCHITECTURE.md#sync-beta-research), `report_playback_state` in [API_CONTRACTS.md](API_CONTRACTS.md).
- **Read:** [Supabase Realtime Presence](https://supabase.com/docs/guides/realtime/presence). Then look up how NTP estimates clock offset, as background for the sync research.

### 8. Testing, observability, TestFlight, privacy and release

- **Why here:** the demo has to work on real phones, the beta has to pass Apple review, and logs must never leak emails, tokens, room codes or song history.
- **In the repo:** [ARCHITECTURE.md § 10](ARCHITECTURE.md#10-testing-strategy), [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md), [PRODUCT_SPEC.md § 11](PRODUCT_SPEC.md#11-public-beta).
- **Read:** [React Native Testing Library](https://callstack.github.io/react-native-testing-library/), [Maestro](https://docs.maestro.dev/), [TestFlight](https://developer.apple.com/testflight/), [EAS Build](https://docs.expo.dev/build/introduction/)

## Milestones and topics

| Dates | Milestone | Topics |
|---|---|---|
| Nov 17–19 | Scaffold, design system, screen shells, docs | 1, 2, 3 |
| Nov 19–21 | Auth, onboarding, provider-optional flow | 3, 4 (Auth), 5 |
| Nov 22–24 | Rooms, codes, QR, RLS, presence, queue RPCs | 4, 7 (presence) |
| Nov 25–27 | Search, matching, availability, Spotify `aux` | 2 (pure functions and tests), 5 |
| Nov 28–30 | MusicKit bridge, Apple `aux`, background audio | 6 (Moussa) |
| Dec 1–3 | Two-phone tests, freeze, TestFlight, rehearsal | 8 |

## What we learned

Add an entry per milestone: date, who, the slice, what clicked, what's still fuzzy.

```text
### YYYY-MM-DD · <milestone> · <name>
- Slice:
- What clicked:
- Still fuzzy:
- Next read:
```
