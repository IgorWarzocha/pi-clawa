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
| `.pi/claw.jsonc` | Bootstrap flag, worker definitions, naming, sockets, compaction. |
| `.pi/clawa-memory.sqlite` | Shared raw memory database. |
| `.pi/pulses.json` | First-seen, last-run, due-key, and deferral state per Pulse. |
| `.pi/clawas/session-registry.json` | Managed worker session records. |
| `.pi/clawas/sessions/` | Managed worker session material where applicable. |
| `.pi/clawa-discord/` | Optional adapter token config, routes, channel snapshot, DB, delivery state, logs. |

The main Clawa's ordinary sessions use Pi's normal session store. Do not assume they live beside
managed worker sessions.

## Ephemeral control state

Clawas comms uses project-scoped Unix sockets under `$XDG_RUNTIME_DIR` or the OS temp directory. The
project root is hashed to avoid collisions, then `controlSocketDir` names the inner directory.
Aliases are refreshed while sessions live.

Socket files and stale process locks are runtime artifacts, not memory. They can be recreated after
all owning processes stop. Do not delete them under a live main or manual worker session.

## What to back up

Back up living documents, vault, worker homes, config, memory, and any Pulse/Discord state you care
about. Logs, sockets, caches, and generated channel snapshots are usually diagnostic or recreatable.
Session histories are valuable when continuity matters; inspect Pi's actual session paths first.
