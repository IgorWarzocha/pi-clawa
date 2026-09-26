---
title: Runtime architecture
description: Trace the extension lifecycle from Pi startup to shutdown.
section: Reference
order: 130
---

The package entrypoint is `src/index.ts`. Pi imports it as an extension factory. The factory creates
one Clawas runtime, Pulse runtime, hydration state, memory-pass state, and comms server, then
registers hooks, commands, tools, renderers, and main-only controls.

## Session start

On every startup, reload, new session, resume, or fork, the extension:

1. creates or reads `.pi/claw.jsonc`;
2. resolves defaults and synchronizes the process environment;
3. names worker sessions when running in worker role;
4. performs protective bootstrap when needed;
5. migrates an existing `vault/` into shared `memory/` and imports legacy SQLite rows without deleting the database;
6. starts a per-session local comms socket;
7. refreshes and persists the current home snapshot as a hidden session message;
8. attaches Clawas and the Pulse timer in a UI-bearing main session;
9. queues invisible conversational onboarding after the first successful bootstrap.

`session_shutdown` drains the current comms alias maintenance and Pulse work. Worker tabs remain
open after main quits or reloads.

## Prompt shaping

Before an agent starts, Clawa filters Pi context files to the resolved home, removes global agent
context, and swaps Pi's generic assistant-introduction portion for the configured main or worker
identity. Pi's tool/runtime prompt remains intact.

Custom `.pi/SYSTEM.md` content and earlier extensions' full-prompt replacements are ignored with a
warning. An opaque replacement cannot be filtered to the home. Compatible additions belong in
`.pi/APPEND_SYSTEM.md` or an extension's structured prompt sections. Extensions loaded after Clawa
can still override its prompt. This is home-scoping behavior, not a sandbox against other extensions.

## Continuity context

Hydration is model-visible session history, not a provider-only rewrite. At session start Clawa reads
the bounded living documents and optional image, then persists one hidden custom message without
triggering a turn. After compaction it refreshes that payload unless the same hydration remains active
in Pi's rebuilt branch. This keeps Pi's native compaction serializer, provider continuation, and the
model's actual context aligned.

Nested `AGENTS.md` context remains separate. It arrives progressively through relevant read and
discovery tool results as work reaches governed paths.

## Context threshold and compaction

Local mode checks usage after completed tool calls and before a successful run settles. It disables
Pi's automatic threshold compaction. At the configured threshold, 90% by default, it reminds
the resident Clawa to checkpoint useful state with `notes` before calling `new_context`.
That native Pi boundary retains the JSONL history without a model-written summary. Manual
`/compact` and Pi's overflow recovery remain available. `clawa.contextManagement: "pi"` leaves
Pi's usual threshold compaction active instead. `/memory remember` queues a separate idle
consolidation in a fresh private Pi session without live extensions. That session has only a bounded
memory-file tool for shared memory and the five living-document owners, not shell, network, bot, or
Git tools. It leaves changes uncommitted. Queued jobs survive restart; interrupted work requeues,
while ordinary failures stay visible for explicit retry.

## Main and worker roles

`PI_CLAWAS_ROLE=worker` fixes the worker role at module load. Workers receive notes and history,
hydration, prompt shaping, context management, comms, and private reporting, but not the main monitor,
`/steer`, `/jump`, or Pulse GUI.

Workers are ordinary Pi sessions, each in a named Herdr tab or tmux window. The main runtime opens or
adopts these tabs; `.pi/clawas/session-registry.json` keeps both session history and terminal location.
Closing a tab stops its worker until a message or `/jump` reopens it. Local newline-delimited socket messaging
carries private coordination without using Pi subprocess RPC or placing messages on a public adapter.
