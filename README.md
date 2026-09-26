# Clawa for Pi

**[Documentation](https://igorwarzocha.github.io/pi-clawa/)** ·
**[Changelog](CHANGELOG.md)** ·
**[Releases](https://github.com/IgorWarzocha/pi-clawa/releases)**

Clawa brings an OpenClaw-style personal agent into Pi in an attempt to make the Clankers speak
hooman. Pi stays Pi: your models, tools, extensions, sessions, and terminal remain underneath.

The point is not persistence alone. Clawa's living home and bundled `warmth-pass` skill keep
identity-bearing docs precise without letting them slide into compliance bark, corporate filler, or
generic assistant voice. The runtime keeps putting that shaped voice back into context.

It keeps raw Pi underneath—your models, tools, extensions, sessions, and terminal—then adds the home
layer:

- living identity and relationship documents;
- shared Markdown memory, chat-local notes, and searchable Pi history;
- long-lived specialist Clawas with internal coordination;
- folder-based scheduled and manual Pulses;
- local context checkpoints and fresh windows, or opt-in Pi compaction;
- an optional Discord adapter.

The result stays open-ended. Add normal Pi packages and extensions when the home needs more.

## How it fits into Pi

Clawa replaces Pi's generic assistant introduction with the resident Clawa's identity while keeping
Pi's tool and runtime context. Instructions are contained to the active Clawa home: global and
outside-parent context files are excluded, while nested `AGENTS.md` files inside the home load as
work reaches them.

Five living documents are rehydrated without accumulating duplicate context: `CLAW.md`, `HUMAN.md`,
`CLAWAS.md`, `CURIOUS.md`, and `TOOLS.md`. `AGENTS.md` remains the behavior spine. The main Clawa uses
ordinary Pi sessions; specialists keep independent homes and sessions.

Near 90% of the active model window by default, Clawa prompts a checkpoint in chat-local notes before
starting a fresh window. No summary appears automatically. Choose `clawa.contextManagement: "pi"`
to use Pi's usual compaction instead. Pi's `/compact` and overflow recovery remain available in
local mode. Shared files live in `memory/`. The optional
`/memory remember` command queues a separate memory pass when the session is idle.

The [runtime reference](https://igorwarzocha.github.io/pi-clawa/docs/reference/runtime/) traces the
full lifecycle. The [privacy page](https://igorwarzocha.github.io/pi-clawa/docs/reference/privacy/)
states the actual trust boundaries without pretending the extension is a sandbox.

## Install

Use Pi 0.87.1 or newer on Linux with `flock` available. The local memory toolkit uses Linux's
no-follow file checks and process locks. Keep the package checkout separate from the clean folder
that will become the Clawa home. Tagged releases are the stable update channel.

```sh
git clone --branch v0.3.0 --depth 1 https://github.com/IgorWarzocha/pi-clawa.git
mkdir -p ~/clawa-home
cd ~/clawa-home
pi -e /absolute/path/to/pi-clawa
```

To remember the checkout for this home, run the helper from the home directory:

```sh
/absolute/path/to/pi-clawa/scripts/install-project.sh
pi
```

First run creates the home and starts a short conversational onboarding. Existing core home files
stop automatic bootstrap rather than being overwritten. See the
[installation](https://igorwarzocha.github.io/pi-clawa/docs/getting-started/installation/) and
[first-run](https://igorwarzocha.github.io/pi-clawa/docs/getting-started/first-run/) guides before
adapting an existing OpenClaw or Hermes home.

## The useful entrances

- `/claw` — inspect the crew, open a Clawa's tab, or create a specialist.
- `/steer` — send an internal nudge to a specialist.
- `/jump` — open or focus a specialist's named Herdr tab (or tmux window). The same session stays
  messageable and reporting while you type there.
- `/pulse` — inspect Pulses or run one manually.
- `notes` / `history` — write chat checkpoints or shared memory and search earlier Pi windows.
- `new_context` — start a fresh window after checkpointing; `/memory` shows status and queues consolidation.

The wiki owns the detail:

- [The Clawa home](https://igorwarzocha.github.io/pi-clawa/docs/guide/home/)
- [Context, memory, and continuity](https://igorwarzocha.github.io/pi-clawa/docs/guide/context-memory/)
- [Specialist Clawas](https://igorwarzocha.github.io/pi-clawa/docs/guide/clawas/)
- [Pulses](https://igorwarzocha.github.io/pi-clawa/docs/guide/pulses/)
- [Configuration](https://igorwarzocha.github.io/pi-clawa/docs/reference/configuration/)
- [Troubleshooting](https://igorwarzocha.github.io/pi-clawa/docs/reference/troubleshooting/)

## Bundled skills

- `clawa-ops` — home operations, specialists, Pulses, config, and imports.
- `warmth-pass` — stops home prose from flattening back into assistant voice.
- `skill-creator` — creates or tunes skills when a lane needs one.
- `clawa-vault` — keeps the shared second brain shaped and navigable.

## Discord adapter

The optional adapter lives at `packages/pi-clawa-discord/` and is still WIP. Add it from the same
checkout, open the Pi tab for the home you want to connect, and run `/discord`. That home can have
its own bot; a specialist can connect a different bot from its own tab. For a first message and
migration from the old gateway, see the [Discord guide](website/src/content/docs/operate/discord.md).

## Development

```sh
bun install
bun run ai:check:strict
```

Normal pushes test the extension and docs. Tagged releases are deliberate batches; documentation
changes can deploy without pretending the extension itself has shipped again.
