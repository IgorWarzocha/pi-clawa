# TODO

## Rule of attack

Do not start clean-room/end-to-end testing until the feature set below is ready enough to test in one pass. Otherwise we will keep reinstalling, rebootstraping, and redoing the same manual checks.

## Product direction from QA

- North star: a warm, intimate companion layer for people who already live with agents.
- Stay a thin Pi layer: do not own model routing, generic tools, a full gateway empire, or a fake task system.
- Own the taste/home layer: living docs, nested context, companion memory, Clawas lanes, and optional surfaces.
- Keep the low-bloat test as few concepts, not just few files.
- Clawas are created for real specialized lanes; no default generic worker.
- Memory should first preserve human texture and curiosity sparks, with shaped truth in living docs and shared `memory/`.
- Discord is a core surface, not a toy; DMs and free safe/on-brand posting matter.
- Heartbeat is gone; Pulse is the Clawa-native scheduled/ambient wake layer.

## Dependency map

```text
A. Package/install shape
  -> B. First-run bootstrap
  -> C. Core runtime surfaces
  -> D. Optional adapters
  -> E. Release docs/checks
  -> F. Clean-room test pass
```

`F` only starts after `A-E` are done enough.

## A. Package/install shape

Status: mostly settled; final proof is a full clean-room install/package pass.

- [x] root package is `@howaboua/pi-clawa`
- [x] local project install config exists at `install/pi-settings.json`
- [x] install helper script creates project `.pi/settings.json`
- [x] main Clawa sessions use Pi's normal session store; project settings only wire packages
- [x] workspace package exists for Discord adapter
- [x] decide final core config filename for this pass: `.pi/claw.jsonc`
- [x] keep setup automatic; refine first-run behavior from real clean-room failures
- [x] verify package exports are intentional, not accidental internals

Depends on: nothing.
Blocks: all clean-room testing.

## B. First-run bootstrap

Status: working and taste-tested; remaining work is template review and full clean-room replay.

- [x] extension config has `bootstrapped: false/true`
- [x] first run copies `templates/main/*` into project root
- [x] first run sends bootstrap instructions programmatically
- [x] first run then proceeds into normal runtime path
- [x] finalize first bootstrap prompt around progressive calibration, not a one-shot interrogation (`src/extension/onboarding.ts` `INITIAL_BOOTSTRAP_PROMPT`; worksheet text in `templates/bootstrap/PRIVACY.md`)
- [x] finalize main markdown templates
- [x] finalize worker seed templates
- [x] make bootstrap idempotence policy explicit
- [x] add a focused bootstrap test/smoke script
- [x] clean-room judge the first-run conversation for taste: specific voice, curiosity, restraint, no flat helper voice (`~/Work/tries/2026-06-20 clawa-cleanroom-bootstrap-final` local-extension smoke)

Depends on: A config names should be settled first.
Blocks: clean-room install test.

## C. Core runtime surfaces

Status: usable and stricter; remaining work is mostly UX polish from real use.

- [x] Clawas runtime copied into core package
- [x] monitor widget replaces footer status
- [x] `/steer` targets active/numbered/named claw
- [x] `/jump` opens active/numbered/named claw
- [x] `/claw` remains management console
- [x] keep local checkpoints separate from Pi's native compaction
- [x] hydration loads main continuity markdowns
- [ ] simplify `/claw` remaining screens/actions if real use keeps exposing awkwardness
- [x] remove or retire parked `/clawas` command code if unused
- [x] repeated `/jump` and `/claw` recovery tested in playground
- [x] retire shared home SQLite memory in favor of `memory/` and chat notes
- [x] store subclaw Pi sessions in each subclaw home under `.pi/sessions`
- [x] sharpen the memory loop: notice → checkpoint privately → promote shaped truth into living docs or shared memory → search later
- [x] make memory guidance prioritize human texture and curiosity sparks before project bookkeeping
- [ ] consider Clawa rename/folder/config alignment after a seed grows into a better name

Depends on: A, B.
Blocks: clean-room runtime test.

## D. Optional adapters

Status: In-process per-home Pi adapter replacing the shared gateway. Live Discord compatibility is
not verified yet.

- [x] Optional adapter package and `/discord` home setup
- [x] Per-home token, in-tab turns, explicit `[mN]` and `[c]` delivery, and local history
- [x] No forced Discord worker, router, subprocess, or `discordEnabled` flag
- [ ] Verify first connection, DM and mention replies, attachments, rich interactions, and search with real Discord bots
- [ ] Verify distinct bot tokens across main and worker tabs, duplicate-token lease rejection, tab close, reload, resume, and config restart at settlement
- [ ] Polish `/discord` states and copy after live use
- [ ] Calibrate ambient posting in real rooms; default remains opt-in and never requires a reply
- [ ] Decide whether to generate invite URL or keep manual instructions

Depends on: C runtime surfaces.
Blocks: full clean-room test if Discord is included in first release.

## E. Release docs/checks

Status: git-repo release-shaped; full clean-room install is still pending.

- [x] `bun run ai:check` passes
- [x] strict cleanup complete: `bun run ai:check:strict` passes
- [x] README pass after product shape settles
- [x] git install instructions for core package
- [x] local-checkout install instructions for adapter package until npm publishing
- [x] security notes for local secrets and external adapters
- [x] package publish checklist
- [x] GitHub Pages reference site, canonical changelog, and content-bound deployment
- [x] CI on normal pushes plus manual tag/release workflow for deliberate batches

Depends on: A-D feature shape.
Blocks: publishing.

Strict release gate:

1. Keep `bun run ai:check:strict` green.
2. Do not add broad ignores to make checks pass; fix code/contracts instead.
3. If strict debt reappears, burn it down before clean-room release testing.

Git release checklist:

1. `bun run ai:check`
2. clean-room install pass from an empty project using a local checkout path
3. dispatch the release workflow once the clean-room pass is good; it tags and publishes
4. if publishing to npm later, run `npm pack --dry-run --json` for root and Discord adapter first

## F. Clean-room test pass

Status: onboarding clean-room pass was done; full install/runtime/adapter pass remains.

Run only after A-E are ready enough.

No separate `init` / `doctor` layer for now. The package should just work on first run; if the clean-room pass finds friction, fix the boot path directly.

Test once, in this order:

1. create empty project
2. run install helper / Pi package install
3. start Pi
4. verify bootstrap creates root markdowns
5. verify bootstrap prompt is sent
6. verify config flips to bootstrapped
7. restart Pi and confirm no rebootstrap
8. create a specialized Clawa seed from `/claw`
9. verify monitor widget
10. verify `/steer`
11. verify `/jump`
12. verify `/claw` management actions
13. verify local checkpoint and fresh window preserve useful continuity without an automatic summary
14. install Discord adapter
15. run `/discord` setup without token
16. save fake token/channel and verify config writes only
17. if using a real token, verify Discord message round trip

## Pulse scheduled/ambient lane

Status: first implementation exists and has had real-life playground pressure.

Pulse replaces heartbeat/cron as one Clawa-native concept: markdown definitions in each Clawa home under `pulses/`, with each Clawa responsible for its own pulse folder.

Done:

- [x] recursive template copy creates `pulses/AGENTS.md`
- [x] main template includes `weekly-pulse-review/` and every-30-minutes `hey-clawa/` pulse folders
- [x] worker template includes lane pulse journal
- [x] scheduler scans main and subclawa homes
- [x] supports `every`, `daily`, `weekly`, and `at` schedules
- [x] pulse runs use compact custom message provenance
- [x] `/pulse` opens the pulse tab; `/pulse run <id>` exists for manual run-now
- [x] pulse scheduler state is tiny runtime state at `.pi/pulses.json`
- [x] pulse scheduler uses roughly five-minute resolution
- [x] Hey Clawa collision handling delays ambient wake when a specific same-owner pulse is due
- [x] playground proved main pulse dispatch, subclawa pulse dispatch, and collision delay
- [x] pulse docs live in `skills/clawa-ops/references/pulses.md`

Needs follow-up:

- [ ] optionally prove `hey-clawa/` specifically inside a subclawa home if we want exact coverage
- [ ] tune `pulses/AGENTS.md` journal shape only if more real runs show it becoming noisy
- [ ] decide whether active-hours/social delivery belongs in Pulse config or higher-level comms policy
- [ ] consider persistent run records only if markdown journal/session transcripts prove insufficient

## Replacement work-tracking lane

Status: not designed.

The extracted extension no longer carries the old work-tracking integration. It was too complex and too home-specific for this package.

Pick a simpler replacement for routing durable work between claws. Options are open:

- markdown files
- JSON/JSONL
- SQLite
- a tiny local task protocol
- something else, if it stays simple

Requirements:

- easy to inspect and edit by hand
- local-first
- no hidden service dependency
- generic enough for any Clawa install
- small API for listing work, assigning work, and reporting status
- clean UI surface in `/claw` or the monitor widget later
- do not mention a task protocol in templates until it exists

Depends on: C runtime surfaces.
Do not block first clean-room test unless we decide work tracking is part of first release.

## Memory tools

Shared knowledge lives in `memory/`; chat checkpoints live in `.pi/context/notes/`.
`clawa_memory` writes and searches both scopes. `clawa_history` reads canonical Pi JSONL through the
house catalog and committed memory revisions. Pi or optional Codex owns context continuity.
Clawa launches residents independently; optional Codex sharing binds fresh sessions through Clawa's
own sockets without Shepherdr. Existing sessions keep their family.
`/memory remember` queues a separate consolidation, and `/memory retry <jobId>` handles failed jobs.
Existing `vault/` files migrate automatically without overwriting collisions. The old SQLite
database is retained as a read-only source after exact row export into `memory/legacy/`.
