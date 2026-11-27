# Maestro flows

End-to-end smoke flows for the iOS app, run with [Maestro](https://maestro.dev). They run on the Mac (Moussa), not in CI: CI has no iOS simulator, and Maestro Cloud needs an account and a build to upload.

**Status: written and statically checked, never executed.** `__tests__/maestro-flows.test.ts` parses every flow on each `npm test` and checks that each text it looks for is still in the app's source. Nobody has run them on a simulator yet. The first run on the Mac will probably need a few selector or timing fixes.

## What you need

- **A Debug development build** of the app (bundle ID `app.qd.mobile`) on an iOS simulator. Expo Go uses a different bundle ID, so these flows don't run there.
  - Until the EAS development profile is merged: `npx expo run:ios` on the Mac builds and installs a Debug build and starts Metro. Leave Metro running. Don't commit the `ios/` folder it creates.
  - The `/dev` flows (`host-reconnecting`, `offline`, `room-ended`) need **Debug**: the "Screens" button on Welcome exists only when `__DEV__` is true. A Release build fails them at `subflows/open-screens.yaml`.
  - If the build includes `expo-dev-client`, its launcher opens first and asks for a server. Add an `openLink` step to the dev client URL at the top of each flow, or open the server by hand once before running the flows.
- **Mock data mode.** Run Metro with **no `.env`**, or with `EXPO_PUBLIC_DATA_MODE=mock`, and no `EXPO_PUBLIC_FLAG_REAL_*` flags. The flows sign in with the mock Apple button, which in live auth mode only says Apple sign-in isn't available. Every result here is mock data: mock accounts, mock rooms, a mock invite (labeled "Mock invite · not a working link") and mock music services (labeled "Mock connection · no … account used"). None of it shows that a real integration works.
- **Maestro CLI** (`curl -fsSL "https://get.maestro.mobile.dev" | bash`) and Java 17 or later.

## Running them

```bash
maestro test .maestro/                    # every top-level flow
maestro test .maestro/join-with-code.yaml # one flow
maestro test --include-tags=states .maestro/
```

Maestro runs the top-level files only. Files in `subflows/` are pieces the flows call with `runFlow`, and don't run alone.

Every flow starts with `launchApp: clearState: true`, so each one starts signed out on Welcome with a fresh mock store. The mock state lives in memory, so a later `launchApp` in the same flow (without `clearState`) also resets it.

## The flows and what they should show

| Flow | Expected result |
|---|---|
| `smoke.yaml` | Welcome shows, and "Continue with email" opens Create account. |
| `onboarding.yaml` | A new mock account: Continue stays off until there's a name and 18+ is on. Step 2 lists only Apple Music and Spotify and can be skipped. "I’ll do this later" lands on Home, which greets "Mock Guest". |
| `sign-in.yaml` | Sign in → Continue with Apple goes straight to Home (returning account). Account shows "Signed in with Apple". Sign out returns to Welcome. |
| `start-room.yaml` | A blank name shows "Give the room a name." and turns Start room off. No mode choice and no sync (beta). Rules can be set to Only you or Chosen. Start room opens the room under its new name, as host. |
| `invite.yaml` | Invite people shows the room code, the QR code, the mock label, Copy link and Share. "Make a new link" replaces the QR code. Close returns to the room. |
| `join-with-code.yaml` | A new account with no music service: a wrong code (`ZZZZZ2`), look-alike characters (`0`, `O`), a full room (`FULL22`) and an ended room (`ENDED2`) each show their own message. `9m2xr4` (lowercase, no `QD-`) opens Kitchen Disco as a guest who can add songs. |
| `add-song-queue.yaml` | Add Rain Down from the mock search, see the toast, undo, add again. In Up next, move Lovers Rock down, then remove it. |
| `host-reconnecting.yaml` | `/dev` "Host’s phone leaves" → the listener view shows "Host reconnecting", then "Paused" after 30 seconds. The host-back preview shows "You’re back" and Resume. Takes about a minute. |
| `offline.yaml` | `/dev` "This phone goes offline" → the room shows "You’re offline" and Add a song is off. Offline then back online leaves no notice. |
| `room-ended.yaml` | `/dev` "Host ends the room" → "This room has ended". Back to Home goes to Home. |
| `settings-services.yaml` | Settings shows mock Spotify, labeled as a mock. Connect Apple Music (mock), switch "Play rooms through", disconnect both. Start a room then asks for a music service and won't start. |

Subflows: `subflows/sign-in.yaml` (returning mock account to Home), `subflows/sign-up.yaml` (new mock account through onboarding, no service, to Home), `subflows/start-room.yaml` (default room, as host) and `subflows/open-screens.yaml` (Welcome → `/dev`).

"Wrong version?" has no flow yet. The override card isn't on this branch, so the room never shows the button.

## Writing and fixing flows

- Select by what VoiceOver reads: a button's label, a field's label or visible copy. On iOS a pressable row reads as one label made of all its text, so match it with a regex like `'Start a room.*Pick the room name.*'`. Make the regex specific: without `index`, Maestro taps the first match, and `'Start a room.*'` alone also matches Home's greeting line. No `testID`s exist yet. Add one only when nothing else can tell two elements apart.
- Maestro matches text **case-insensitively**, so a text field's uppercase eyebrow label ("ROOM NAME") matches its field's label ("Room name"). Tap the field with `index: 1`.
- A button with its own `accessibilityLabel` is found by that label, not its visible text (`'Resume the music'`, not `'Resume'`). The Jest check flags this.
- To close the keyboard, tap plain text on the screen instead of `hideKeyboard`: the app's scroll views dismiss it on a tap nothing handles (`keyboardShouldPersistTaps="handled"`). A sheet's footer (the Add a song toast, Start room) sits under the keyboard while it's up.
- Text selectors are regexes. Escape `?`, `(` and `)` (`'Already have an account\? Sign in'`). Split composed copy with `.*` (`'Rain Down.*added.*in line'`) so the check can find each piece in the source.
- Use the curly apostrophe (’), as the app does. Use single quotes in YAML so backslashes stay literal.
- Use only mock data and `example.com` addresses. Never type a password, token or real account.
- When screen copy changes, update the flow in the same PR. `npm test` fails until you do.
