---
title: Commands, tools, and keys
description: Look up Clawa's commands, model tools, and shortcuts.
section: Reference
order: 100
---

## Commands

| Surface | Behavior |
| --- | --- |
| `/claw` | Open the Clawa/Clawas GUI. In a worker it warns; in headless mode it runs bootstrap. |
| `/claw bootstrap` | Run the protective home bootstrap explicitly. |
| `/claw <purpose>` | Create a purpose-seeded specialist when the arguments resolve as a creation request. |
| `/pulse` | Open the GUI on the Pulses tab. Main session only. |
| `/pulse run <target>` | Queue by Pulse ID, `owner:id`, or title. |
| `/steer <message>` | Send an internal steer to the selected monitor worker. |
| `/steer <slot\|worker> <message>` | Target a worker by monitor slot, ID, or title. |
| `/jump [slot\|worker]` | Open or focus a worker's named Herdr tab or tmux window. |
| `/discord` | Optional adapter: configure and connect this home's bot in its Pi tab. |
| `/memory` | Show memory and context status. |
| `/memory remember` | Queue a separate, idle memory consolidation. |
| `/memory retry <jobId>` | Retry a failed consolidation job. |

Pi's `/compact` remains available in both context modes, along with `/model`, `/resume`, and
`/reload`. Pi's overflow recovery remains a fallback in local mode.

## Model-facing tools

### `notes`

List, read, search, append, or write Markdown notes. The default `scope: "notes"` belongs to this
chat and agent; other Clawas can address it by ID. Set `scope: "memory"` for the house's shared
`memory/` tree. Search before writing and preserve links and local instructions.

Reads return `file.version`. Pass it as `expected_version` when replacing content, or pass `null`
to create only if absent. A conflict leaves the newer file intact for rereading and merging.
Omitting the version deliberately performs an unconditional write; background consolidation never
uses that shortcut. Appends are serialized across Clawas.

### `history`

List windows, items, chats, or revisions; read an item or revision; search past content. Session
history comes from Pi's JSONL rather than a copied transcript database. Revisions read committed
shared memory and depend on Git availability.

### `new_context`

Start a fresh context window after checkpointing useful state. It does not automatically summarize.

### `message_clawa`

Main-only coordination route to a worker by ID or title. It refreshes config, opens a stopped worker
tab if needed, and sends a reply-requested steer. Success returns a named receipt rather than
repeating the outgoing note.

### `message_main_claw`

Worker-only internal handoff to the main Clawa. Duplicate status relays in one turn are suppressed.

### `discord_send`

Optional adapter tool for explicit sends, files, rich UI, polls, and reactions. For an ordinary
reply to a displayed message use `[mN]` in the final answer; use `[c]` for a channel post.
Unmarked text stays in Pi.

### `discord_history`

Searches the current home's local Discord history. It does not replace house `history`.

## Keyboard shortcuts

| Key | Behavior |
| --- | --- |
| `Alt+Shift+W` | Fold or open the Clawas monitor. |
| `Alt+Shift+Q` | Select the previous monitor worker. |
| `Alt+Shift+E` | Select the next monitor worker. |

These are registered only in the main Clawa role.
