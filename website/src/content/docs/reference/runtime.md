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
5. starts a per-session local comms socket;
6. refreshes and persists the current home snapshot as a hidden session message;
7. attaches managed Clawas and the Pulse timer in a UI-bearing main session;
8. queues invisible conversational onboarding after the first successful bootstrap.

`session_shutdown` drains the current comms alias maintenance and Pulse work, then stops managed
workers, including any starts still in flight.

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

## Settlement and compaction

Before a successful run settles, Clawa checks usage against the active model's context window.
At the configured memory-pass threshold, 90% by default, the `agent_before_settle` hook appends one
hidden instruction and requests a continuation on the same branch. Aborted and failed runs do not
start a memory pass. The model uses `recall` and `remember` normally, with explicit guidance to
update rather than duplicate and to save nothing when no durable signal emerged.

That follow-up does not compact or call a detached model. Pi's configured default, custom, or
provider-native compactor remains the sole owner of canonical history, threshold, retries, overflow
recovery, and summary shape. The memory pass rearms after `session_compact` or `session_start`.
Pi also owns provider overflow recognition. The memory pass does not delay compaction, which can
happen during a long tool run before the settlement hook is reached.

## Main and worker roles

`PI_CLAWAS_ROLE=worker` fixes the worker role at module load. Workers receive memory/recall,
hydration, prompt shaping, the memory pass, comms, and private reporting, but not the main monitor,
`/steer`, `/jump`, or Pulse GUI.

Managed workers are separate Pi RPC processes. The main daemon owns starting, adoption, restart,
prompt normalization, session registry, and status. Local newline-delimited socket RPC carries
private messages without placing them on a public adapter.
