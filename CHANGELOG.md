# Changelog

This file records user-visible changes to pi-clawa. The project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic versions for tagged
releases. Work lands under **Unreleased** and ships in deliberate batches.

## [Unreleased]

### Added

- Workers can opt into or out of provider Fast Mode independently with `fastMode`.
- The Discord adapter can turn exact server joins and leaves into durable, deduplicated worker turns
  for routed channels visible to the member when the Server Members intent is enabled.

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

[Unreleased]: https://github.com/IgorWarzocha/pi-clawa/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/IgorWarzocha/pi-clawa/releases/tag/v0.2.0
[0.1.0]: https://github.com/IgorWarzocha/pi-clawa/releases/tag/v0.1.0
