# Clawa for Pi

**[Modern docs](https://igorwarzocha.github.io/pi-clawa/modern/docs/getting-started/installation/)** ·
**[Changelog](https://igorwarzocha.github.io/pi-clawa/modern/changelog/)** ·
**[Modern and legacy](https://igorwarzocha.github.io/pi-clawa/versions/)** ·
**[Releases](https://github.com/IgorWarzocha/pi-clawa/releases)**

Clawa gives your Pi agent a home: a name, a relationship, memory, and room to grow. The living
Markdown documents and bundled `warmth-pass` skill help it speak hooman without losing precise
instructions. Pi still owns your models, tools, extensions, sessions, and terminal.

The home includes shared Markdown memory, long-lived specialist Clawas with their own sessions,
and scheduled or manual Pulses. Add ordinary Pi extensions when you need more capabilities.
The optional Discord adapter lets each home connect its own bot.

## Install modern

Install **v0.4.0** for the modern architecture described here. The `modern` branch carries its next
updates. **v0.3.1 belongs to legacy**, the supported earlier architecture. The
[edition comparison](https://igorwarzocha.github.io/pi-clawa/versions/)
and [legacy docs](https://igorwarzocha.github.io/pi-clawa/legacy/docs/getting-started/installation/)
cover that architecture. Both lines receive maintenance; release tags stay unchanged.

Use Linux with `flock`, Node.js `>=24.15.0 <27`, and Pi **0.99.2 or newer** with a configured
provider. Both Clawa branches require this Pi baseline.
Install Clawa per home, not globally. Keep the package checkout separate from a clean
home directory:

```sh
mkdir -p ~/src
git clone --branch v0.4.0 https://github.com/IgorWarzocha/pi-clawa.git ~/src/pi-clawa
mkdir -p ~/clawa-home
cd ~/clawa-home
pi -e ~/src/pi-clawa
```

To load it whenever you start Pi in this home, run the helper **from the home directory**:

```sh
~/src/pi-clawa/scripts/install-project.sh
pi
```

The helper refuses to replace existing Pi settings. If you already have `.pi/settings.json`, add the
checkout path to its `packages` array instead. See the
[installation guide](https://igorwarzocha.github.io/pi-clawa/modern/docs/getting-started/installation/).

First run creates the home and waits for your message. Say hello to get acquainted, or give it a
task. There is no autonomous startup turn or setup wizard. Existing core home files block bootstrap
rather than being overwritten. Read
[First run](https://igorwarzocha.github.io/pi-clawa/modern/docs/getting-started/first-run/)
before adapting an existing home. Later, resume from the home with `pi -c`.

Clawa runs with Pi's user permissions, not in a sandbox. Home context can reach your model provider.
The [privacy guide](https://igorwarzocha.github.io/pi-clawa/modern/docs/reference/privacy/)
explains what is loaded, shared, and sent.

## Around the home

- `/claw` opens the crew view and creates specialists.
- `/steer` sends a specialist an internal message.
- `/jump` opens or focuses its named Herdr tab or tmux window. Messages and reports still work
  while you type there.
- `/pulse` shows scheduled work or runs a Pulse manually.
- `clawa_memory` reads and writes shared Markdown. Use `scope: "notes"` for stored chat checkpoints.
- `clawa_history` searches house conversation archives and committed memory revisions.
- `/memory` shows consolidation status. `/memory remember` freezes the conversation, starts a
  fresh one, and queues optional consolidation when idle.

Specialists have independent homes and ordinary Pi sessions. Clawa launches and connects them
itself, without Shepherdr. Worker tabs need Herdr or tmux and stay open when main exits. Pulses need
a running main session.

Pi owns compaction. Optional Pi Codex owns its configured continuity instead. Clawa does not run a
second rollover engine or set context thresholds. Generic `notes`, `history`, `new_context`, and
`get_context_remaining` are not Clawa tools.

With Pi Codex **3.0.42 or newer**, optional subagent context sharing can connect fresh residents to
the main session's context family before their first task. Existing sessions keep their identity.
See [Specialist Clawas](https://igorwarzocha.github.io/pi-clawa/modern/docs/guide/clawas/)
for storage and routing limits. Codex is not required for shared home memory or coordination.

## Read more

- [The Clawa home](https://igorwarzocha.github.io/pi-clawa/modern/docs/guide/home/)
- [Context, memory, and continuity](https://igorwarzocha.github.io/pi-clawa/modern/docs/guide/context-memory/)
- [Pulses](https://igorwarzocha.github.io/pi-clawa/modern/docs/guide/pulses/)
- [Configuration](https://igorwarzocha.github.io/pi-clawa/modern/docs/reference/configuration/)
- [Upgrading](https://igorwarzocha.github.io/pi-clawa/modern/docs/operate/upgrading/)
- [Troubleshooting](https://igorwarzocha.github.io/pi-clawa/modern/docs/reference/troubleshooting/)

Agents can use the [plain-Markdown upgrade procedure](https://igorwarzocha.github.io/pi-clawa/modern/docs/operate/upgrading/index.md)
to explain or carry out an authorized migration.

The bundled skills are `clawa-ops` for home operations, `warmth-pass` for identity-bearing prose,
`skill-creator` for skills, and `clawa-vault` for organizing shared knowledge.

## Discord

Load `packages/pi-clawa-discord/` from the same checkout alongside Clawa. In the Pi tab for the
home you want to connect, run `/discord`. Each home can have its own bot, including specialists.
Follow the
[Discord guide](https://igorwarzocha.github.io/pi-clawa/modern/docs/operate/discord/)
for setup and migration from the legacy gateway.

## Development

Use a full-history clone. The strict gate builds both editions and needs the legacy Git source:

```sh
bun install
CLAWA_LEGACY_REF=origin/legacy bun run ai:check:strict
```

The build looks for local `legacy`, then `origin/legacy`, unless you set the override. A shallow,
modern-only checkout is not enough. Updates on either maintained branch trigger one Pages
deployment built from modern's frontend and both branches' docs. Tags remain the release channel.
A docs deployment is not an extension release. See the
[release policy](https://igorwarzocha.github.io/pi-clawa/modern/docs/project/release-policy/).
