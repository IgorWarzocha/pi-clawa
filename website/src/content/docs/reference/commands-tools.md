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
| `/steer <message>` | Send a private steer to the selected monitor worker. |
| `/steer <slot\|worker> <message>` | Target a worker by monitor slot, ID, or title. |
| `/jump [slot\|worker]` | Open a manual worker panel through Herdr or tmux. |
| `/discord` | Optional adapter: create config/worker as needed and open Discord setup. |

Pi's own commands—including `/compact`, `/model`, `/resume`, and `/reload`—remain available.
Clawa customizes their surrounding lifecycle rather than replacing Pi's command system.

## Model-facing tools

### `remember`

Creates a memory with `text` and optional `tags`; updates when `id` is present; deletes when an `id`
is paired with empty text. Tags are normalized, deduplicated, and capped at 12.

### `recall`

Searches shared memory and the current Clawa's session history. Accepts an optional text `query`,
memory `tags`, and result `limit`. Tags do not filter session results. Tool calls and tool results are
excluded from session search.

### `message_clawa`

Main-only private sideband to a worker by ID or title. It refreshes config, refuses delivery to a
human-owned manual session, ensures a managed worker is running, and sends a reply-requested steer.

### `message_main_claw`

Worker-only private handoff to the main Clawa. Duplicate private status relays in one turn are
suppressed.

### `message_discord`

Optional adapter tool for explicit Discord sends, files, rich UI, polls, and reactions. Ordinary final
Discord replies should still use the worker's required route blocks.

## Keyboard shortcuts

| Key | Behavior |
| --- | --- |
| `Alt+Shift+W` | Fold or open the Clawas monitor. |
| `Alt+Shift+Q` | Select the previous monitor worker. |
| `Alt+Shift+E` | Select the next monitor worker. |

These are registered only in the main Clawa role.
