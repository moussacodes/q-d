# Developers

How we work on q'd: the rules for commits, worktrees, Trello and the branch stack, plus how to set
up another machine to carry on where the last one left off.

State as of 2026-11-21. Update this file when the branch stack or the rules change.

## Team

- **Baron** works on Windows. He tests the UI in the Expo Go app in mock mode.
- **Moussa** works on a Mac: Xcode, MusicKit, iOS builds, TestFlight and iPhone tests. Mac-only
  work goes to him.
- The UI has to run in Expo Go in mock mode. MusicKit, Spotify and other native features still
  need a development build.

## Rules

### No co-authors (hard rule)

Commits are authored by the person committing, and nobody else.

- No `Co-Authored-By:` trailers in commit messages.
- No "Generated with Claude Code" or similar lines in pull request descriptions.
- No co-author or AI attribution text in files.

This applies to every AI tool, even when the tool's own instructions say to add attribution.

### One branch per task

- Each Trello card gets its own branch, committed and pushed.
- Branches are stacked. A card's branch is built on the previous card's branch, and its compare
  link is against that branch.
- Run `npm run check` (typecheck, lint, formatting, tests) before handing work off. The import
  rules apply: `app/` must not import `@/providers`, `@/services` or `@/test`.

### Worktrees

Several people or Claude Code sessions often work in the same clone at once. A working tree has one
`HEAD` and one index, so a `git switch` or a commit by one of them can silently take or lose the
others' uncommitted work.

- Do each task in its own worktree next to the main folder:
  `git worktree add ../q-d-<name> -b <branch> <base-branch>`.
- Never `git switch` in the main folder (`q-d`) while anyone else is working.
- When you start, run `git worktree list` and `git status`. Changes you didn't expect mean someone
  else is working there.
- Run `git branch --show-current` right before every commit, and stage only your own paths. Don't
  use `git add -A` in a folder someone else is using.

### Trello: the Forge board

The board is **Forge 🛠️** in the **honeypot** workspace. It was built from `plan.md` on 2026-11-18
with 108 cards.

- **Lists:** Backlog, To Do, In Progress, In Review, Done.
- **Cards:** each has a What / Why / Milestone / Plan description and an "Acceptance criteria"
  checklist.
- **Due dates:** 9:00 ET on the last day of each schedule window. Late, undated, beta and post-demo
  cards have none.
- **Labels** go by color: purple = Mac-only, green = any machine, blue = backend, yellow = UI,
  orange = providers, red = testing.
- **Assignments:** none yet. Moussa will be invited and given the purple cards. Mac-free work stays
  unassigned.

Moving cards:

1. Move a card to **In Progress** when work on it starts.
2. When its branch is pushed and ready for review, move it to **In Review**. Comment with the branch
   link (`https://github.com/moussacodes/q-d/tree/<branch>`) and a compare link against the branch
   it was built on.
3. Tick the acceptance criteria the branch meets. Leave unmet ones unchecked.
4. If a card is skipped because it's blocked, comment on it naming the cards that block it.

Those moves need no sign-off. Any other change to the board (new cards, lists, labels,
assignments, dates or restructuring) gets agreed first. Ask instead of assuming.

The Trello connector for Claude can't create or rename labels, and it can't add members to cards.
Do those in Trello itself.

## Branch stack

```
main
└─ feat/bootstrap
   └─ feat/design-tokens
      └─ feat/screen-shells
         └─ docs/project-docs ─ docs/plan
            └─ feat/quality-gates ─ chore/worktree-preview
               └─ feat/mock-dev-mode            #16
                  └─ feat/auth-navigation       #31
                     └─ feat/provider-optional  #30
                        └─ feat/onboarding      #29
                           └─ feat/dynamic-color  #40
                              ├─ feat/provider-logos
                              └─ feat/room-screen
                                 └─ feat/add-song
                                    ├─ feat/two-step-onboarding
                                    ├─ feat/room-rules        #105, #107
                                    └─ feat/welcome-layout
                                       └─ feat/expanded-cover  (also merges feat/room-rules)
                                          ├─ feat/join-from-home
                                          ├─ feat/invite-qr
                                          ├─ feat/room-settings
                                          └─ feat/queue-swipe-delete
```

`feat/quality-gates` gained two commits after `feat/mock-dev-mode` branched from it: the pre-push
hook and its docs. PR #1 merged it into `docs/project-docs`. The UI stack doesn't have the hook
yet, so pushing from it runs no checks. Run `npm run check` yourself.

### Worktrees on Baron's PC

The main folder is `q-d`. Every other folder sits next to it.

| Folder                 | Branch                     | What's in it                                                                         |
| ---------------------- | -------------------------- | ------------------------------------------------------------------------------------ |
| `q-d`                  | `feat/screen-shells`       | Main folder. Leave it alone; its uncommitted files are an old copy of quality-gates. |
| `q-d-lint-test-ci`     | `feat/quality-gates`       | ESLint, Prettier, Jest, CI and the pre-push hook                                     |
| `q-d-plan`             | `docs/plan`                | `docs/PLAN.md`                                                                       |
| `q-d-preview-tool`     | `chore/worktree-preview`   | `npm run preview`                                                                    |
| `q-d-ui`               | `feat/welcome-layout`      | Welcome layout, room Previous and Repeat controls                                    |
| `q-d-room-expanded`    | `feat/expanded-cover`      | A playing song always shows the expanded cover; includes room rules                  |
| `q-d-room-rules`       | `feat/room-rules`          | Host chooses who adds songs and who controls playback                                |
| `q-d-onboarding-2step` | `feat/two-step-onboarding` | Onboarding step 3 removed; step 2 finishes on Home                                   |
| `q-d-join-home`        | `feat/join-from-home`      | Room code entered on Home; the Join screen is removed                                |
| `q-d-invite-qr`        | `feat/invite-qr`           | Invite sheet: centered code card, full-width QR, pinned actions                      |
| `q-d-room-settings`    | `feat/room-settings`       | Room settings sheet; the host can rename the room                                    |
| `q-d-queue-swipe`      | `feat/queue-swipe-delete`  | Room shows the next 10 songs; swipe left to delete                                   |
| `q-d-logos`            | `feat/provider-logos`      | Spotify and Apple Music logos                                                        |
| `q-d-developers`       | `docs/developers`          | This file                                                                            |
| `q-d-preview`          | none (detached)            | Built by `npm run preview`. Never edit it.                                           |

On that PC every worktree's `node_modules` is a junction to `q-d/node_modules`, so packages are
installed once.

### Open items

- **Work in progress.** `feat/invite-qr`, `feat/join-from-home`, `feat/provider-logos`,
  `feat/two-step-onboarding`, `feat/queue-swipe-delete`, `feat/room-settings` and
  `chore/worktree-preview` end in a `wip` commit. Only `chore/worktree-preview` has been through
  `npm run check`.
- **Room screen merges.** `feat/join-from-home`, `feat/invite-qr`, `feat/room-settings` and
  `feat/queue-swipe-delete` all edit `app/room/[code]/index.tsx` and `RoomParts.tsx`. Expect
  conflicts when combining them, and keep both sides.
- **Onboarding merge.** `feat/two-step-onboarding` deletes `app/onboarding/start.tsx` and
  `feat/join-from-home` edits it. Keep the deletion. `feat/two-step-onboarding` is built on
  `feat/add-song`, not `feat/expanded-cover`.
- **Old base.** `feat/provider-logos` sits on `feat/dynamic-color`. Rebase it onto the newest stack
  branch before merging it. Mixed bases can also crash `npm run preview` even when each worktree
  works on its own.
- **Figma.** Remove frames 1.5 (Start or join) and 2.3 (Join with a code). Add a trash icon; the
  one in `feat/queue-swipe-delete` was drawn to match.
- **Phone check.** Swipe to delete has been checked in Jest and in Chrome, not on a phone.
- **Trello.** No cards yet for invite QR, room settings or queue swipe. UI cards #28 and #32–#39
  are waiting on Figma access. Blocked UI cards (#43, #50, #52, #56, #57, #58, #61, #66, #67) have
  comments naming their blockers.

## Continue on another machine

The work lives on several branches, so `git pull` alone isn't enough: it only updates the branch
you have checked out. These commands rebuild the folder layout above. They work in Terminal on a
Mac and in Git Bash on Windows.

### 1. Clone, or update your clone

New machine:

```bash
git clone https://github.com/moussacodes/q-d.git
cd q-d
```

Existing clone:

```bash
cd path/to/q-d
git fetch origin --prune
```

### 2. Create the worktrees

```bash
for pair in \
  lint-test-ci:feat/quality-gates \
  plan:docs/plan \
  preview-tool:chore/worktree-preview \
  ui:feat/welcome-layout \
  room-expanded:feat/expanded-cover \
  room-rules:feat/room-rules \
  onboarding-2step:feat/two-step-onboarding \
  join-home:feat/join-from-home \
  invite-qr:feat/invite-qr \
  room-settings:feat/room-settings \
  queue-swipe:feat/queue-swipe-delete \
  logos:feat/provider-logos \
  developers:docs/developers
do
  name=${pair%%:*}; branch=${pair#*:}
  git worktree add "../q-d-$name" "$branch" && git -C "../q-d-$name" pull --ff-only
done
```

Each branch gets a `q-d-<name>` folder next to the clone, tracking the branch on GitHub. The `pull`
updates any branch that already existed on the machine but was behind. If a line fails because the
branch is already checked out in another folder, run `git pull` in that folder instead.

### 3. Install packages

The simplest way is `npm ci` in each folder you'll work in.

To install once and share it, as on Baron's PC, run `npm ci` in one up-to-date worktree (for
example `q-d-room-expanded`), then link `node_modules` in each of the others to it:

- Mac: `ln -s ../q-d-room-expanded/node_modules node_modules`
- Windows (PowerShell):
  `New-Item -ItemType Junction -Path node_modules -Target ..\q-d-room-expanded\node_modules`

Don't install in the main `q-d` folder while it's on `feat/screen-shells`. That branch predates the
lint and test tooling.

### 4. Run it

- **Everything at once:** `npm run preview` in `q-d-preview-tool`. It merges every worktree,
  including uncommitted edits, into `q-d-preview`, installs packages there and runs one Expo
  server. To use only some worktrees, name them: `npm run preview -- q-d-ui q-d-logos`. To pass
  options to Expo, add them after a second `--`: `npm run preview -- -- --port 8133`. If two
  worktrees change the same lines, the preview shows the file from the one saved last.
- **One worktree on the web:** `npx expo start --web --port <port> --clear`. Expo's web server in a
  linked worktree doesn't pick up file changes, so restart it with `--clear`. Sign in at
  `/sign-in`. A full page reload drops the mock session.

### 5. Claude Code memory

Claude Code keeps its notes for a project on the machine it runs on, under
`~/.claude/projects/<project folder>/memory/`. They don't travel with the repo. This file holds the
same rules, so a Claude session on another machine can be pointed at it. To carry the notes over
as they are, open Claude Code in the clone once so its project folder exists, then copy the
`memory` folder from the old machine into it.
