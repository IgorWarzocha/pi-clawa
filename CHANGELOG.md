# Changelog

This file records user-visible changes to pi-clawa. The project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic versions for tagged
releases. Work lands under **Unreleased** and ships in deliberate batches.

## [Unreleased]

## [0.4.0] - 2026-10-01

The first modern release. Requires Pi **0.99.2 or newer** and Linux with `flock`. Existing homes
must follow the [upgrade guide](https://igorwarzocha.github.io/pi-clawa/modern/docs/operate/upgrading/)
before switching from legacy. Legacy's Pi compatibility update is released separately as **0.3.1**.

### Added

- Separate modern and legacy documentation, a branch comparison, and a redesigned site. Legacy
  and modern each own their guides and changelog. Existing guide links still reach legacy.
- Plain-Markdown guides and changelogs, an `llms.txt` index, and an agent-readable modern upgrade
  procedure covering installation discovery, restart handoff, migration checks, and rollback limits.
- Fresh resident sessions can join the main session's optional Codex context family before their
  first task, using Clawa's own sockets without Shepherdr. Resumed sessions keep their identity.
  Requires Pi Codex 3.0.42 or newer with sharing enabled and compatible notes continuity in both
  homes. Binding failures stop the launch; another extension's peer router is never replaced.
- Afreet-derived local notes, shared Markdown memory, searchable house Pi history, and committed-memory
  revisions through `clawa_memory` and `clawa_history`. Memory defaults to shared home Markdown;
  explicit `scope: "notes"` accesses retained per-chat notes.
- An optional CodeMode adapter exposes namespaced house and message tools when CodeMode is present.
  Codex is not required to use Clawa.
- `/memory remember` freezes a conversation, starts a fresh one, and queues a durable background
  memory pass. `/memory` shows status and `/memory retry <id>` retries failures. The private memory
  bot can edit only memory and living-document owners, with version checks on replacements; it has
  no shell, network-action, bot, or Git tools.

### Changed

- Both `modern` and `legacy` now require Pi 0.99.2 or newer. Legacy keeps its managed-worker and
  SQLite-memory architecture, not an older Pi dependency. Development checks use Pi 0.99.2.
- Bundled `clawa-ops` now routes installs and modern upgrades to the packaged guides instead of
  assuming every tagged checkout has modern behavior. Skill-authoring guidance favors concise
  triggers and task-specific instructions over mandatory document scaffolding.
- `clawa_memory` and `clawa_history` replace `remember` and `recall`. Existing `vault/` files move automatically
  into `memory/` without overwriting conflicts. Legacy SQLite rows are imported exactly; the old
  database stays unchanged as a retired source. The local toolkit requires Linux with `flock`.
- Clawa no longer runs its own rollover engine or MemoryPass threshold. Plain Pi owns compaction;
  optional Pi Codex owns its configured continuity. Remove obsolete `contextManagement`,
  `memoryPass`, and `memoryPassThreshold` fields from older Clawa configs. Generic `notes`, `history`,
  `new_context`, and `get_context_remaining` are not Clawa tools. Existing notes and window archives
  remain accessible through the house tools.
- Global installs stay dormant in ordinary directories without `.pi/claw.jsonc`, adding no Clawa
  tools, skills, prompt, or runtime. This is a safety net, not a recommended install path. Use a
  tagged git checkout per home through project settings or explicit `pi -e`; global installation
  is discouraged. Existing configured homes still activate globally.
- First run creates home files but waits for the first human message or task. There is no autonomous
  startup turn, and a concrete first task takes priority over introductions. Fresh sessions remain
  idle until their launching controller has completed any optional context binding.
- Living-document text refreshes in Pi's native structured prompt before each agent turn, including
  after Pi or Codex continuity. The optional self-card image is deduplicated in native session
  history rather than repeated every turn.
- Clawa adds native identity and home sections without replacing Pi's introduction or taking prompt
  ownership from other extensions. Custom prompts are preserved; opaque full overrides can hide
  home context, so use structured sections or `.pi/APPEND_SYSTEM.md` for compatible additions.
- The optional Discord adapter now connects each bot inside its own main or specialist Pi tab.
  `/discord` configures that home's token, intake, and connection; there is no required Discord
  worker, shared gateway process, route file, or `discordEnabled` worker flag. Replies use exact
  `[mN]` handles, channel posts use `[c]`, and unmarked final text stays in Pi. Rich sends use
  `discord_send`; local searchable history uses `discord_history`.
- Discord bot tokens now live in each home's `.pi/clawa-discord/bot.env`. Existing `config.env`
  and `routes.jsonc` are not read or migrated. Stop the old gateway with the old `/discord` before
  updating, then reconnect each desired home through the new `/discord`. Existing worker homes,
  session history, and Discord archive data remain untouched. Pending turns and rich action tokens
  do not survive disconnect or reload.
- Specialist Clawas now run in named Herdr tabs or tmux windows instead of managed RPC
  subprocesses. `/jump` and `/claw` open or focus the same worker tab; split-pane launches are gone.
  Typing directly never disconnects private messaging or reporting. Main reloads and exits leave
  tabs running; closing a worker tab stops it until the next message or jump. Worker config changes
  take effect at the next tab launch, not in a running session.
- Upgrading from 0.3 requires stopping the old main session before starting this version so its
  legacy subprocess workers can stop. Worker session history is preserved.

### Fixed

- Missing model or authentication now produces an actionable wake error without blocking later
  tasks after repair. Unacknowledged starts stay visible and are never automatically resent.
- Idle reports and main Pulses prepare Clawa's identity, home context, and services before running.
  Failed readiness checks do not append duplicate Pulse instructions on each scheduled retry.
- Worker tabs inherit Pi provider and launch settings, including custom-provider environment
  references, without copying the main tab's terminal identity or exposing credentials in launch errors.
- Explicit reopen can replace a tmux location whose server process is confirmed dead. Uncertain
  host checks still block duplicate tabs.

## [0.3.0] - 2026-09-24

Requires Pi **0.87.1 or newer**. No home-state migration is required.

### Added

- Workers can opt into or out of provider Fast Mode independently with `fastMode`.
- The Discord adapter can turn exact server joins and leaves into durable, deduplicated worker turns
  for routed channels visible to the member when the Server Members intent is enabled.

### Changed

- Clawa now targets Pi 0.87.1. Prompt shaping uses Pi's live structured options instead of a copied
  prompt builder, preserving current tool policies and extension sections. Earlier opaque prompt
  replacements are ignored with a warning because they cannot be filtered to the home.
- The memory pass uses Pi's actionable pre-settlement boundary rather than starting another run
  after settlement. It no longer starts after cancellation or a failed run.
- All check commands now use the same strict gate. The default typecheck no longer skips checking.

### Fixed

- Shutdown drains pending worker starts, Pulse deliveries, and socket alias maintenance instead of
  leaving background work behind. Malformed worker RPC results fail at the process boundary.
- Bootstrap preserves existing nested home files and only marks in-memory success after saving
  the configuration.
- Discord replies retain the current message target when a Clawa uses tools before its final answer,
  instead of becoming standalone channel posts and leaving their source turns unsettled.

### Known limitations

- The optional Discord adapter remains WIP. Live join/leave delivery has not been verified.

## [0.2.0] - 2026-08-06

### Changed

- Pi is now the sole compaction owner. At 90% of the active model's context window, Clawa gets one
  same-branch memory pass to recall recent shared memories and save only genuinely new or updated
  continuity before Pi compacts normally. Legacy `clawa.compaction` settings no longer alter this.
- Living-document and optional image hydration is now persisted in session history at lifecycle
  boundaries, so Pi's native compaction and provider continuation rebuild the same model-visible
  branch instead of losing extension-injected context or cache continuity.
- `recall` now takes a fast path for recent shared memories, streams bounded session search, and
  keeps only the strongest results instead of synchronously loading broad session history.
- Worker configuration now has one strict normalization path. Duplicate IDs and malformed booleans,
  thinking levels, report modes, or extension lists fail visibly rather than changing behavior.
- `message_clawa` now returns a concise named delivery receipt instead of repeating the outgoing note.
- Development checks now target Pi 0.84.0.

### Fixed

- Successful Pulse deliveries are checkpointed individually, so a later failed Pulse cannot replay
  work that already landed.
- Failed partial Clawas daemon starts are disposed before retry, and local comms reject malformed
  commands and response payloads at the socket boundary.

## [0.1.0] - 2026-07-23

The first public release of pi-clawa.

### Added

- A warm, long-lived Pi home with automatic conversational onboarding and living home documents.
- Clawas: purpose-seeded specialist homes with internal coordination, a monitor, management UI,
  `/steer`, `/jump`, and independent sessions.
- Shared SQLite memory, session recall, continuity-aware compaction, and bounded home-document
  hydration on every provider call.
- Folder-based Pulses with manual runs, interval and calendar schedules, busy-session queuing,
  local-time context, and optional quiet hours.
- Bundled `clawa-ops`, `warmth-pass`, `skill-creator`, and `clawa-vault` skills.
- Optional visual identity hydration from a root-level `CLAWA` image.
- An optional, work-in-progress Discord adapter with explicit reply routing, attachments, rich
  interactions, reactions, polls, and the **Apps → Ask Clawa** context action.

### Changed

- The main Clawa uses normal Pi sessions. Specialist Clawas keep their sessions in their own homes.
- Pi's assistant introduction is replaced with Clawa's identity while Pi's runtime and tool context
  remain intact.
- Instruction context outside the Clawa home is filtered out. Nested `AGENTS.md` files inside the
  home are loaded progressively as work reaches them.
- Automatic compaction defaults to 80% of the active model's context window and extracts at most
  three short durable memories.

### Known limitations

- The Discord adapter is still WIP. Its lifecycle, multi-channel and DM policy, and autonomy model
  may change.
- Pulses and managed Clawas need a UI-bearing main Pi session to remain running. They are not an OS
  service, and pulse timing is deliberately approximate.
- `/jump` needs Herdr or tmux; a plain standalone terminal cannot open a managed worker panel.
- Bootstrap protects existing homes rather than merging them. Any existing core home document
  blocks automatic setup.

[Unreleased]: https://github.com/IgorWarzocha/pi-clawa/compare/v0.4.0...modern
[0.4.0]: https://github.com/IgorWarzocha/pi-clawa/releases/tag/v0.4.0
[0.3.0]: https://github.com/IgorWarzocha/pi-clawa/releases/tag/v0.3.0
[0.2.0]: https://github.com/IgorWarzocha/pi-clawa/releases/tag/v0.2.0
[0.1.0]: https://github.com/IgorWarzocha/pi-clawa/releases/tag/v0.1.0
