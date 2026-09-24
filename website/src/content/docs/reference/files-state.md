---
title: Files and runtime state
description: Find durable home data and disposable runtime state.
section: Reference
order: 120
---

Paths below are relative to the main home unless noted.

## Human-readable state

| Path | Purpose |
| --- | --- |
| `AGENTS.md` | Main behavior spine. |
| `CLAW.md`, `HUMAN.md`, `CLAWAS.md`, `CURIOUS.md`, `TOOLS.md` | Hydrated living documents. |
| `CLAWA.<image>` | Optional visual identity card. |
| `vault/` | Shared shaped knowledge. |
| `pulses/<id>/PULSE.md` | Main Pulse definitions. |
| `clawas/<id>/` | Default specialist homes, including their own Pulses and local files. |

These are user data. Do not recreate them from templates during normal upgrades.

## Project-local runtime state

| Path | Purpose |
| --- | --- |
| `.pi/settings.json` | Pi package and project settings. |
| `.pi/claw.jsonc` | Bootstrap flag, worker definitions, naming, sockets, and memory-pass settings. |
| `.pi/clawa-memory.sqlite` | Shared raw memory database. |
| `.pi/pulses.json` | First-seen, last-run, due-key, and deferral state per Pulse. |
| `.pi/clawas/session-registry.json` | Worker session history and terminal location records. |
| `<worker-home>/.pi/sessions/` | Each worker's Pi session history. |
| `<home>/.pi/clawa-discord/bot.env` | Optional per-home bot token and intake settings, created mode `0600`. |
| `<home>/.pi/clawa-discord/gateway.db`, `archive-pending.json`, `assets/`, `channels.json` | Local searchable Discord history, pending archive writes, cached media, and channel snapshot. |

The main Clawa's ordinary sessions use Pi's normal session store. Do not assume they live beside
worker sessions.

## Ephemeral control state

Clawas comms uses project-scoped Unix sockets under `$XDG_RUNTIME_DIR` or the OS temp directory. The
project root is hashed to avoid collisions, then `controlSocketDir` names the inner directory.
Each worker's alias points to its current Pi session.

Socket files and stale process locks are runtime artifacts, not memory. They can be recreated after
all owning processes stop. Do not delete them under a live main or worker session.

## What to back up

Back up living documents, vault, worker homes, config, memory, and any Pulse/Discord state you care
about. Pending Discord turns and rich action tokens live only in memory; the archive remains across
disconnects. Sockets, caches, and generated channel snapshots are usually recreatable.
Session histories are valuable when continuity matters; inspect Pi's actual session paths first.
