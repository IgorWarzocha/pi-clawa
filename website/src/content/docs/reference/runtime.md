---
title: Runtime architecture
description: An end-to-end trace from extension factory through session start, prompt shaping, provider context, compaction, workers, Pulses, and shutdown.
section: Reference
order: 130
---

The package entrypoint is `src/index.ts`. Pi imports it as an extension factory. The factory creates
one Clawas runtime, Pulse runtime, in-memory hydration state, compaction gate, and comms server, then
registers hooks, commands, tools, renderers, and main-only controls.

## Session start

On every startup, reload, new session, resume, or fork, the extension:

1. creates or reads `.pi/claw.jsonc`;
2. resolves defaults and synchronizes the process environment;
3. names worker sessions when running in worker role;
4. performs protective bootstrap when needed;
5. starts a per-session local comms socket;
6. marks hydration stale so the next provider context gets a fresh home snapshot;
7. attaches managed Clawas and the Pulse timer in a UI-bearing main session;
8. queues invisible conversational onboarding after the first successful bootstrap.

`session_shutdown` stops the current comms server, Pulse timer, and managed worker runtime. The
Discord package has its own gateway ownership rules.

## Prompt shaping

Before an agent starts, Clawa filters Pi context files to the resolved home, removes global agent
context, and swaps Pi's generic assistant-introduction portion for the configured main or worker
identity. Pi's tool/runtime prompt remains intact.

Custom `.pi/SYSTEM.md` content is intentionally ignored with a warning. Compatible additions belong
in `.pi/APPEND_SYSTEM.md`. This prevents a second full system identity from silently fighting the
home spine.

## Provider context

The context hook removes older Clawa hydration messages, bounds historical image content, and
prepends exactly one current living-document block. It runs on each model/tool-loop call, including
the first call after compaction. Nested `AGENTS.md` context arrives progressively through relevant
tool results instead of the opening hydration block.

Normal replies use Pi's selected model. Clawa makes one direct model call of its own: continuity
compaction, using the active model, resolved authentication, current thinking level, and a token
budget bounded by Pi's reserve.

## Settlement and compaction

After an agent run has fully settled—no retry, compaction, or follow-up pending—the policy checks
model-relative usage. At the configured threshold it asks Pi to compact. A gate prevents Pulses and
comms from racing that operation. Certain opaque provider overflow errors are normalized to Pi's
recognized context-length error so normal recovery can happen.

## Main and worker roles

`PI_CLAWAS_ROLE=worker` fixes the worker role at module load. Workers receive memory/recall,
hydration, prompt shaping, compaction, comms, and private reporting, but not the main monitor,
`/steer`, `/jump`, or Pulse GUI.

Managed workers are separate Pi RPC processes. The main daemon owns starting, adoption, restart,
prompt normalization, session registry, and status. Local newline-delimited socket RPC carries
private messages without placing them on a public adapter.

## Failure posture

Critical operations surface visible errors rather than reporting success after a failed handoff.
Compaction summary and memory persistence degrade separately. Invalid Pulse definitions remain
visible in the GUI. Some UI notifications naturally do not exist in print/JSON modes; the complete
always-on runtime is intentionally a TUI/RPC shape, not a headless service.
