# Clawa for Pi

**[Documentation](https://igorwarzocha.github.io/pi-clawa/)** ·
**[Changelog](CHANGELOG.md)** ·
**[Releases](https://github.com/IgorWarzocha/pi-clawa/releases)**

Clawa brings an OpenClaw-style personal agent into Pi in an attempt to make the Clankers speak
hooman. Pi stays Pi: your models, tools, extensions, sessions, and terminal remain underneath.

The point is not persistence alone. Clawa's living home and bundled `warmth-pass` skill keep
identity-bearing docs precise without letting them slide into compliance bark, corporate filler, or
generic assistant voice. The runtime keeps putting that shaped voice back into context.

Clawa adds the home layer:

- living identity and relationship documents;
- shared Markdown memory, chat-local notes, and searchable Pi history;
- long-lived specialist Clawas with internal coordination;
- folder-based scheduled and manual Pulses;
- living-home context that stays current through Pi compaction or optional Pi Codex continuity;
- an optional Discord adapter.

The result stays open-ended. Add normal Pi packages and extensions when the home needs more.

## How it fits into Pi

Clawa adds the resident Clawa's identity through Pi's native structured prompt while preserving
Pi's tool context and other extensions' prompt ownership. Context files are scoped to the active home:
global and outside-parent context files are excluded, while nested `AGENTS.md` files inside the
home load as work reaches them.

Five living documents join Pi's structured prompt before each agent turn: `CLAW.md`, `HUMAN.md`,
`CLAWAS.md`, `CURIOUS.md`, and `TOOLS.md`. `AGENTS.md` remains the behavior spine. The main Clawa uses
ordinary Pi sessions; specialists keep independent homes and sessions.

Pi owns compaction. If you add Pi Codex, it owns its configured continuity instead. Clawa does not
run a second rollover engine or set context thresholds. Shared files live in `memory/`; old chat
notes and window archives remain accessible. `/memory remember` freezes the conversation, starts a
fresh one, and queues optional consolidation when idle. Codex is not required.

The [runtime reference](https://igorwarzocha.github.io/pi-clawa/docs/reference/runtime/) traces the
full lifecycle. The [privacy page](https://igorwarzocha.github.io/pi-clawa/docs/reference/privacy/)
states the actual trust boundaries without pretending the extension is a sandbox.

## Install

Use Pi 0.87.1 or newer on Linux with `flock` available. The local memory toolkit uses Linux's
no-follow file checks and process locks. Keep the package checkout separate from the clean folder
that will become the Clawa home. Install Clawa per home, not globally. Tagged git checkouts are the
stable update channel.

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

First run creates the home, then waits for your first message or task. A greeting opens introductions;
a concrete task comes first. There is no autonomous startup turn. Existing core home files stop
automatic bootstrap rather than being overwritten. See the
[installation](https://igorwarzocha.github.io/pi-clawa/docs/getting-started/installation/) and
[first-run](https://igorwarzocha.github.io/pi-clawa/docs/getting-started/first-run/) guides before
adapting an existing OpenClaw or Hermes home.

A global Clawa install stays dormant as a safety net, not a recommended setup. In ordinary directories
without `.pi/claw.jsonc`, it adds no Clawa tools, skills, prompt, or runtime. Existing configured
homes activate globally. A project install
or explicit `pi -e` deliberately creates a new home as above.

## The useful entrances

- `/claw` — inspect the crew, open a Clawa's tab, or create a specialist.
- `/steer` — send an internal nudge to a specialist.
- `/jump` — open or focus a specialist's named Herdr tab (or tmux window). The same session stays
  messageable and reporting while you type there.
- `/pulse` — inspect Pulses or run one manually.
- `clawa_memory` — read and write shared home Markdown by default; use `scope: "notes"` for stored chat notes.
- `clawa_history` — search house conversation archives and committed memory revisions.
- `/memory` — show memory status and queue optional consolidation.

Generic `notes`, `history`, `new_context`, and `get_context_remaining` are not Clawa tools. They
depend on an optional continuity extension such as Pi Codex. An optional CodeMode adapter exposes
Clawa's house and message tools through namespaces when CodeMode is present.

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
