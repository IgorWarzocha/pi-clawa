---
title: Specialist Clawas
description: Create and operate long-lived specialist Clawas.
section: Core concepts
order: 50
---

Clawas are specialists with their own homes and Pi sessions. They are not disposable one-shot
subagents. Each owns a lane, keeps local memory, can have Pulses, and shares only the relationship and
crew map that should remain common.

## Create one

Open `/claw` and use the creation flow, or give `/claw` a purpose in text. Creation:

1. makes a worker home under `clawas/` by default;
2. applies the worker template and purpose seed;
3. symlinks the root `HUMAN.md` and `CLAWAS.md` into the worker home;
4. adds the worker to `.pi/claw.jsonc` and the crew map;
5. best-effort starts or refreshes the worker.

The worker's local `CLAW.md`, `CURIOUS.md`, `TOOLS.md`, nested instructions, vault work, and session
history can diverge around its lane. Shared human and crew files keep handoffs grounded.

## Worker panels

An enabled, autostart worker opens a native Pi session in a background Herdr tab or tmux window. The
runtime adopts an existing panel instead of opening a second session. The session registry records
both history and panel location so workers can resume when possible. Model, thinking level, extension
paths, Discord enablement, and reporting mode are supplied from the worker definition at panel launch.
Editing config does not change a running Pi session.

Main reloads, exits, and config refreshes leave worker panels running. Closing a worker panel stops
that worker. The next message or `/jump` can reopen its existing session; a crash does not trigger
automatic respawn.

## Talk to a Clawa

- `/steer <message>` sends to the selected monitor worker.
- `/steer <slot|worker> <message>` targets one explicitly.
- The main model can use `message_clawa` for private worker coordination.
- A worker can use `message_main_claw` once per turn for an internal handoff or status.

Private messages use project-scoped Unix sockets, not Pi subprocess RPC. Messages and reports remain
available while you type directly in the worker's panel. A steer to an active worker becomes a
follow-up; a steer or follow-up to an inactive worker becomes a new prompt. Delivery failures surface
an error rather than pretending the handoff landed. A successful
`message_clawa` call acknowledges the named recipient without echoing the outgoing note back into the
tool result.

## Reporting modes

Each worker can set `reportMode`:

- `auto` — useful final results can report privately to the main Clawa;
- `explicit` — report only through an explicit private message;
- `off` — no automatic report-back.

Report-back is fingerprinted to avoid duplicates. Recent explicit mail and route-aware Discord work
also affect whether an automatic status is useful.

## Monitor and panels

The main TUI shows worker state and task summaries. Keyboard controls:

| Key | Action |
| --- | --- |
| `Alt+Shift+W` | Fold or open the monitor. |
| `Alt+Shift+Q` | Select the previous worker. |
| `Alt+Shift+E` | Select the next worker. |

`/jump [slot|worker]` focuses an existing panel or opens the stopped worker's session. It requires
Herdr or tmux. In an ordinary standalone terminal it warns and does nothing.

## Settings scope

Workers run from their own cwd. Pi project settings, local skills, and discovered instructions are
therefore scoped to the worker home, not automatically copied from the main home. Use the worker's
`extensions` field when it genuinely needs extra extension paths.
