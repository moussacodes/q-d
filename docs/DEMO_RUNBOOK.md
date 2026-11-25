# Demo runbook

How to run the December 4, 2026 demo, prepare for it, and recover when something breaks.

> **Draft.** The flow, the fallbacks and the account reset are set. Device names and accounts get filled in during the Dec 1–3 rehearsals. Anything marked **TBD** must be resolved by Dec 3.

## The demo

- **Length:** 3–5 minutes.
- **Mode:** `aux` only. One host phone plays, and everyone adds songs.
- **Story:** the four points from the pitch deck's last slide, shown live.

| # | Beat | What the audience sees | Time |
|---|---|---|---|
| 0 | Setup | One line: "Different apps. One aux." The host is already signed in, with a service connected. | 0:20 |
| 1 | Create or join | The host starts a room. The second phone joins with the six-character code, then show the QR invite. | 0:50 |
| 2 | Search and add | The guest (no music service connected) searches and adds a song. The host adds one too. | 0:50 |
| 3 | Live queue | Both phones show the queue update within two seconds. The host reorders a song. | 0:40 |
| 4 | Host plays | Playback starts on the host's service. With Apple Music, lock the host iPhone to show it keeps playing. With Spotify, keep q’d in the foreground. | 0:50 |
| 5 | Honest states | Show a song that isn't on the host's service, and the "switch for the next song or skip" choice. | 0:30 |
| — | Close | "Thanks. Questions?" | — |

Cut beat 5 first if time runs short. Never cut beat 4.

## People, phones and accounts

| Role | Device | OS | Account | Music service |
|---|---|---|---|---|
| Host | **TBD** iPhone | Stable iOS | Demo account 1 (Apple sign-in) | Apple Music subscription, and/or Spotify Premium (one of the five development users) |
| Guest | **TBD** iPhone | iOS 27.3 beta | Demo account 2 (email or Google) | None, which proves guests don't need one |
| Backup | Laptop | — | — | Plays the recorded backup video |

- Build: the internal TestFlight build from Dec 3. Write down the build number here: **TBD**.
- Backend: the demo Supabase project, never production.

## Timeline before the demo

| Date | What |
|---|---|
| Dec 1 | Two-phone integration test on normal Wi‑Fi, the venue network and a hotspot. **Provider release gate:** decide whether Apple and Spotify are each stable enough. |
| Dec 2 | **Feature freeze.** If either real provider is unstable, switch it to the clearly labeled mock. Record the backup demo video. |
| Dec 3 | Install the internal TestFlight build on both phones. Full rehearsal with timing. Practice the account reset. Verify the backup video plays on the laptop. |
| Dec 4 | Demo. |

## Checklists

### The night before

- [ ] Both phones are on the Dec 3 TestFlight build and fully charged.
- [ ] Demo accounts are signed in. The host's service is connected and the authorization hasn't expired.
- [ ] Spotify: the host account is still one of the five development users, and the app owner's Premium is active.
- [ ] Apple Music: the host's subscription is active, and a test song plays with the screen locked.
- [ ] Demo data is reset with the script (see below), and a second dry run shows nothing left to do.
- [ ] The backup video is on the laptop, available offline.
- [ ] The hotspot phone is charged, and both demo phones have connected to it once.

### 30 minutes before

- [ ] Connect both phones to the venue Wi‑Fi. Run the flow end to end once with a throwaway room, then end that room.
- [ ] Do Not Disturb is on for both phones. Notifications are off.
- [ ] Host volume is set, and audio goes to the venue speaker (or the phone speaker as planned).
- [ ] Screen mirroring is tested, if used.
- [ ] Spotify (if used) is open and active on the host phone.

### Reset between rehearsals

The reset is a script: [`supabase/scripts/reset-demo-accounts.js`](../supabase/scripts/reset-demo-accounts.js). It calls the operator-only `reset_demo_accounts` function ([API_CONTRACTS.md § reset_demo_accounts](API_CONTRACTS.md#reset_demo_accounts-operator-only)). Run it from the laptop that holds the demo project's service-role key, never from a phone.

For the demo accounts, and nobody else, it:

- ends every room they host that's still open, the same way **End room** does: the code expires and is free again, playback stops, the QR invite stops working, and any phone still in the room gets `room.ended`,
- deletes those rooms' queues, playlist imports and memberships, so Home shows no leftover rooms,
- deletes the accounts' idempotency keys and failed join attempts, so a rehearsal's wrong codes can't lock the guest out.

It doesn't touch profiles or music-service connections, and it never touches a room someone else hosts. It reports how many of those the accounts are in, and how many accounts aren't onboarded or have no service connected.

**Once, before the first rehearsal (Moussa or Baron, whoever holds the key):**

1. In the **demo** Supabase project's SQL editor, turn the reset on. It's off in every other project, production included, so the script can't reset anything there:
   `update private.feature_flags set enabled = true where flag = 'demo_reset';`
2. Create `.env.demo.local` in the repo root (git ignores it). Fill in the four names from `.env.example`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the two demo accounts in `QD_DEMO_EMAILS` (or their ids in `QD_DEMO_USER_IDS`). Never commit it, never paste the key into chat, and never give it an `EXPO_PUBLIC_` name.

**Each reset (between rehearsals, the night before, and after the 30-minute run-through):**

1. Dry run. It changes nothing and prints counts only:
   `node --env-file=.env.demo.local supabase/scripts/reset-demo-accounts.js`
2. Check the first line names the demo project (`Project: <ref>.supabase.co`), and the counts look right.
3. Apply it:
   `node --env-file=.env.demo.local supabase/scripts/reset-demo-accounts.js --yes`
4. Run the dry run again. Every "to end", "to revoke" and "to delete" line must say 0. Running it twice is safe.
5. Act on any `note:` line: a demo account still in someone else's room (leave it from the app), an account without a finished profile, or the host with no service connected.
6. On both phones, confirm the account is still signed in and the host's service is still connected. Pull to refresh Home: no rooms are left.

If the script says the `demo_reset` flag is off, you're pointed at the wrong project, or step 1 of the setup wasn't done. Don't turn the flag on anywhere but the demo project.

## If something breaks

| Symptom | First move | Fallback |
|---|---|---|
| Venue Wi‑Fi is slow or down | Switch both phones to the hotspot | Play the backup video |
| The guest's add doesn't show on the host | Pull to refresh (queries refetch from Postgres) | Add the song from the host phone and keep going |
| The host shows "Host reconnecting" | Check the host's network. It recovers within 30 seconds, or the room pauses with the queue kept. | Rejoin the room from Home |
| The real provider won't play | Say so plainly, then switch the host's service between songs | Use the labeled mock (decided Dec 2), or play the backup video |
| Spotify won't connect | Open the Spotify app, start any song, and return to q’d | Use Apple Music as the host's service |
| The app crashes | Relaunch. The room and the queue live on the server, so they're still there. | Backup video |

## What we say, and what we never say

- **Say:** the host's phone plays the music, guests don't need a service, and the queue is shared and live.
- **Never say** that everyone hears it on their own service or "in sync", that q’d streams Spotify audio, or that YouTube Music, TIDAL, Amazon Music or Deezer work.
- If a mock is used, say so on stage. The app labels it too.
- If someone asks about sync: "That's research for after the demo, and it depends on provider approval."

The full list is in [PRODUCT_SPEC.md § 9](PRODUCT_SPEC.md#9-words-we-use-and-claims-we-never-make).
