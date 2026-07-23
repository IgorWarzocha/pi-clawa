# Changelog

This file records user-visible changes to pi-clawa. The project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic versions for tagged
releases. Work lands under **Unreleased** and ships in deliberate batches.

## [Unreleased]

No changes recorded yet.

## [0.1.0] - 2026-07-23

The first public release of pi-clawa.

### Added

- A warm, long-lived Pi home with automatic conversational onboarding and living home documents.
- Clawas: purpose-seeded specialist homes with private coordination, a monitor, management UI,
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

[Unreleased]: https://github.com/IgorWarzocha/pi-clawa/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/IgorWarzocha/pi-clawa/releases/tag/v0.1.0
