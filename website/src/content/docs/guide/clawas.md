---
title: Specialist Clawas
description: Create and operate long-lived specialist Clawas.
section: Core concepts
order: 50
---

Clawas are specialists with their own homes and Pi sessions. They are not disposable one-shot
subagents. Each keeps local memory and can have Pulses. By default, the human and crew documents
are shared with the main home.

## Create one

Open `/claw` and use the creation flow, or give `/claw` a purpose in text. Creation:

1. makes a worker home under `clawas/` by default;
2. applies the worker template and purpose seed;
3. symlinks the root `HUMAN.md` and `CLAWAS.md` into the worker home;
4. adds the worker to `.pi/claw.jsonc` and the crew map;
5. attempts to start or refresh the worker.

The worker has its own `CLAW.md`, `CURIOUS.md`, `TOOLS.md`, nested instructions, and session
history. It can also work with shared house memory.

## Worker tabs

Each Clawa gets a Herdr tab or tmux window named after its title, never a split pane. An enabled,
autostart worker opens in the background when the main session connects. With autostart off, an
enabled worker opens when needed. The runtime adopts an existing tab instead of opening a second
session. The session registry records both history and tab location so workers can resume when
possible. Model, thinking level, extension paths, and reporting mode are supplied from the worker
definition at launch. A loaded Discord adapter travels with Clawa into worker tabs; `/discord` in a
worker tab controls only that worker home's separate bot.
Editing config does not change a running Pi session.

Main reloads, exits, and config refreshes leave worker tabs running. Closing a worker tab stops
that worker. The next message or `/jump` can reopen its existing session; a crash does not trigger
automatic respawn.

## Optional shared working context

Clawa works on Pi alone and does not require Shepherdr. Shared house Markdown and private messages
work without Codex.

With Pi Codex 3.0.42 or newer, turn on subagent context sharing in the main session's `/codex`
settings to connect newly launched resident sessions to its context family. Both sessions need
active notes-based continuity. Local and Tree storage work together through Clawa's existing
sockets in either Herdr or tmux. Remote storage requires Remote on both sides and the same Codex
account.

Clawa binds a fresh session before sending its startup prompt or first task. A sharing failure
stops that launch and closes only its newly created tab, rather than sending work into an
unshared session. Existing resident sessions keep their original identity when reopened. Starting
a new main session does not move existing residents into its new family.

Local and Tree access requires the owning sessions and any intermediate parent to remain open.
Codex currently permits one peer router per session. Clawa reports a conflict rather than replacing
another extension's router. Disable that competing router or turn off subagent sharing for new
Clawa launches. House memory and normal coordination remain separate from this optional feature.

## Talk to a Clawa

- `/steer <message>` sends to the selected monitor worker.
- `/steer <slot|worker> <message>` targets one explicitly.
- The main model can use `message_clawa` for private worker coordination.
- A worker can use `message_main_claw` once per turn for an internal handoff or status.

Private messages use project-scoped Unix sockets, not Pi subprocess RPC. Messages and reports remain
available while you type directly in the worker's tab. A steer to an active worker becomes a
follow-up; a steer or follow-up to an inactive worker becomes a new prompt. Delivery failures surface
an error rather than pretending the handoff landed. A successful
`message_clawa` call acknowledges the named recipient without echoing the outgoing note back into the
tool result.

When the recipient shares the main session's Codex family, the receipt also includes its context
agent path for accessing that resident's working notes and history.

## Reporting modes

Each worker can set `reportMode`:

- `auto` allows useful final results to report privately to the main Clawa;
- `explicit` reports only through an explicit private message;
- `off` disables automatic report-back.

Report-back is fingerprinted to avoid duplicates. Recent explicit mail also affects whether an
automatic status is useful.

## Monitor and tabs

The main TUI shows worker state and task summaries. Keyboard controls:

| Key | Action |
| --- | --- |
| `Alt+Shift+W` | Fold or open the monitor. |
| `Alt+Shift+Q` | Select the previous worker. |
| `Alt+Shift+E` | Select the next worker. |

`/jump [slot|worker]` opens or focuses the worker's tab. In `/claw`, select a worker and choose
**Open or focus tab** for the same action. Both require Herdr or tmux; neither creates a split pane.
In an ordinary standalone terminal, `/jump` warns and does nothing.

## Settings scope

Workers run from their own cwd. Pi project settings, local skills, and discovered instructions are
therefore scoped to the worker home, not automatically copied from the main home. Use the worker's
`extensions` field when it genuinely needs extra extension paths.
