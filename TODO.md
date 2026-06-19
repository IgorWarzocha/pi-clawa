# TODO

## Rule of attack

Do not start clean-room/end-to-end testing until the feature set below is ready enough to test in one pass. Otherwise we will keep reinstalling, rebootstraping, and redoing the same manual checks.

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

Status: half-baked.

- [x] root package is `@howaboua/pi-claw`
- [x] local project install config exists at `install/pi-settings.json`
- [x] install helper script creates project `.pi/settings.json`
- [x] workspace package exists for Discord adapter
- [x] decide final core config filename for this pass: `.pi/claw.jsonc`
- [ ] keep setup automatic; refine first-run behavior from real clean-room failures
- [x] verify package exports are intentional, not accidental internals

Depends on: nothing.
Blocks: all clean-room testing.

## B. First-run bootstrap

Status: mechanically working, product flow not final.

- [x] extension config has `bootstrapped: false/true`
- [x] first run copies `templates/main/*` into project root
- [x] first run sends bootstrap instructions programmatically
- [x] first run then proceeds into normal runtime path
- [ ] finalize first bootstrap prompt
- [ ] finalize main markdown templates
- [ ] finalize generic worker templates
- [x] make bootstrap idempotence policy explicit
- [x] add a focused bootstrap test/smoke script

Depends on: A config names should be settled first.
Blocks: clean-room install test.

## C. Core runtime surfaces

Status: usable extracted runtime, still not fully package-shaped.

- [x] Clawas runtime copied into core package
- [x] monitor widget replaces footer status
- [x] `/steer` targets active/numbered/named claw
- [x] `/jump` opens active/numbered/named claw
- [x] `/claw` remains management console
- [x] custom compaction extracts continuity + durable memories
- [x] hydration loads main continuity markdowns
- [ ] simplify `/claw` remaining screens/actions
- [x] remove or retire parked `/clawas` command code if unused
- [ ] formalize worker adapter seam instead of ad-hoc env/extension paths
- [ ] add runtime smoke checks for worker launch/report/steer/jump/restart
- [x] decide whether `.pi/clawa-memory.jsonl` stays for first release

Depends on: A, B.
Blocks: adapter finalization and clean-room runtime test.

## D. Optional adapters

Status: Discord exists, adapter seam still rough.

- [x] Discord package exists at `packages/pi-claw-discord/`
- [x] copied gateway source into adapter package
- [x] core no longer owns direct Discord delivery tool
- [x] `/discord` GUI exists
- [x] `/discord` can save token and channel id
- [x] `/discord` can start/restart/stop gateway
- [x] setup guide doc exists inside adapter package
- [x] GUI helper action sends setup-guidance prompt with doc/source paths
- [ ] polish `/discord` states and copy
- [ ] validate gateway process lifecycle under Pi shutdown/restart
- [ ] decide multi-channel support now vs later
- [ ] decide whether to generate invite URL or keep manual instructions
- [x] add adapter smoke test that does not require a real Discord token

Depends on: C adapter seam.
Blocks: full clean-room test if Discord is included in first release.

## E. Release docs/checks

Status: intentionally minimal so far.

- [x] `bun run ai:check` passes
- [x] strict cleanup plan, not necessarily full strict pass yet
- [x] README pass after product shape settles
- [x] install instructions for core package
- [x] install instructions for adapter package
- [x] security notes for local secrets and external adapters
- [x] package publish checklist

Depends on: A-D feature shape.
Blocks: publishing.

Strict cleanup plan:

1. Keep `ai:check` green as the release gate for now.
2. Burn down Biome warnings first: top-level regex/no-non-null/assertion/simple complexity.
3. Then tackle `typecheck:strict` by area: config/jsonc, comms, daemon/runtime, GUI, Discord adapter.
4. Do not mix strict cleanup with feature work unless the touched file is already in hand.

Publish checklist:

1. `bun run ai:check`
2. `npm pack --dry-run --json`
3. `npm pack --dry-run --json --workspace @howaboua/pi-claw-discord`
4. clean-room install pass from an empty project
5. publish root package, then Discord adapter
6. install published packages in a fresh project and run the smoke path once

## F. Clean-room test pass

Status: not started on purpose.

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
8. create/start worker
9. verify monitor widget
10. verify `/steer`
11. verify `/jump`
12. verify `/claw` management actions
13. verify compaction writes memory
14. install Discord adapter
15. run `/discord` setup without token
16. save fake token/channel and verify config writes only
17. if using a real token, verify Discord message round trip

## Replacement work-tracking lane

Status: not designed.

The extracted extension no longer carries the old work-tracking integration. It was too complex and too house-specific for this package.

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

## Replace JSONL memory storage with SQLite

Status: later.

Compaction now writes extracted durable memories to `.pi/clawa-memory.jsonl`.
That is intentionally simple for the first package pass.

Later, replace it with SQLite when the access pattern is clearer:

- stable ids
- timestamps and tags
- simple search/list/remove commands
- possible promotion into a future editable memory surface
- no external service dependency

Depends on: C compaction behavior proving useful.
Do not block first clean-room test.
