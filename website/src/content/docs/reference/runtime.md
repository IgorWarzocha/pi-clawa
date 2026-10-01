---
title: Runtime architecture
description: Trace the extension lifecycle from Pi startup to shutdown.
section: Reference
order: 130
---

The package entrypoint is `src/index.ts`. Pi imports it as an extension factory. The factory creates
one Clawas runtime, Pulse runtime, hydration state, memory job queue, and comms server, then
registers hooks, commands, tools, renderers, and main-only controls.

## Session start

Activation comes first. A global install stays dormant in directories without `.pi/claw.jsonc`.
Dormant sessions receive no Clawa tools, skills, prompt changes, or running home services. A
configured home activates globally; a project install or explicit `pi -e` also requests automatic
bootstrap.

In an active session, startup, reload, new session, resume, or fork:

1. creates or reads `.pi/claw.jsonc`;
2. performs protective bootstrap when needed;
3. resolves defaults and synchronizes the process environment;
4. names worker sessions when running in worker role;
5. opens the transcript-free comms listener so launchers can deliver the first task;
6. migrates an existing `vault/` into shared `memory/` and imports legacy SQLite rows without deleting the database;
7. prepares living-home hydration for the next agent turn.

First run creates files without starting an autonomous agent turn. Onboarding joins the first human
message or task through `before_agent_start`. A concrete task takes priority over introductions,
so optional context binding can finish before any work begins. Clawas control and the Pulse timer
attach when the first task starts, or when a home command needs them.

`session_shutdown` drains the current comms alias maintenance and Pulse work. Worker tabs remain
open after main quits or reloads.

## Prompt shaping

Before an agent starts, Clawa filters Pi context files to the resolved home and adds the configured
main or worker identity as the native `clawa_identity` section. Living documents use `clawa_home`.
Pi's tool context and other extensions' prompt ownership remain intact, including Codex.

Idle mail, reports, and main Pulses share a coalesced native user kickoff so this preparation also
runs before autonomous work. Reports and Pulses retain their custom-message metadata; during active
work, reports steer and Pulses follow up as before. Readiness failures are reported before dispatch.
Pi's extension send API does not return asynchronous startup errors, so a missing start acknowledgement
is reported as uncertain rather than retried. A later native start clears that fence.

Clawa does not delete custom prompts or opaque full-prompt overrides. An opaque override can hide
home sections and bypass context-file scoping; Clawa warns in the UI when it sees one at its hook.
Use `.pi/APPEND_SYSTEM.md` or structured prompt sections for additions that compose with the home.
This is home-scoping behavior, not a sandbox against other extensions.

## Continuity context

At `before_agent_start`, Clawa reads the bounded living documents into Pi's native structured
prompt. Text refreshes for every turn, including after Pi compaction or optional Pi Codex continuity.
There is no parallel provider rewrite or family-context routing layer.

An optional visual self-card uses a native, deduplicated message on the first turn or after Pi
compaction. It is not repeated on every turn. After external context rollover, a path reminder lets
the Clawa view the image explicitly when needed.

Nested `AGENTS.md` context remains separate. It arrives progressively through relevant read and
discovery tool results as work reaches governed paths.

## Compaction and memory consolidation

Plain Pi owns compaction and overflow recovery. Optional Pi Codex owns its configured continuity.
Clawa has no rollover engine, MemoryPass threshold, or compaction settings. It provides
`clawa_memory` for house Markdown and retained chat notes, and `clawa_history` for house archives
and committed memory revisions. Generic continuity tools belong to the extension that provides
them, not Clawa.

`/memory remember` freezes the current conversation, starts a fresh one, and queues optional idle
consolidation in a private Pi session without live extensions. That session has only a bounded
memory-file tool for shared memory and the five living-document owners, not shell, network, bot, or
Git tools. It leaves changes uncommitted. Queued jobs survive restart; interrupted work requeues,
while ordinary failures stay visible for explicit retry.

## Main and worker roles

`PI_CLAWAS_ROLE=worker` fixes the worker role at module load. Workers receive house memory and history,
hydration, prompt shaping, comms, and private reporting, but not the main monitor,
`/steer`, `/jump`, or Pulse GUI.

Workers are ordinary Pi sessions, each in a named Herdr tab or tmux window. The main runtime opens or
adopts these tabs; `.pi/clawas/session-registry.json` keeps both session history and terminal location.
Closing a tab stops its worker until a message or `/jump` reopens it. Local newline-delimited socket messaging
carries private coordination without using Pi subprocess RPC or placing messages on a public adapter.

Launches forward standard Pi provider, proxy, certificate, and launch environment settings, plus
environment references declared in `models.json` and registered provider configurations. The new host
owns terminal/session identity. The launcher neither resolves credentials nor runs provider commands;
it omits credential-bearing command output from launch errors.

Clawa owns resident launch and communication without Shepherdr. With optional Codex sharing enabled,
fresh resident sessions bind through Codex's public API over the existing Clawa sockets before any
startup prompt or task. Existing sessions are never rebound. Session shutdown fences pending
bindings before waiting for worker connections to drain. Its optional CodeMode adapter exposes
house and message tools without requiring Codex for ordinary Pi use.
