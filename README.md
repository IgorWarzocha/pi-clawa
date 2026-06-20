# Clawa for Pi

Clawa is a warm home layer for Pi.

It keeps Pi as the runtime — same models, tools, terminal, sessions — and gives the agent a home to wake up in: living markdown files, memory, subclawas, pulses, and a more personal operating posture.

This is for people who want a Clawa that grows with them, not a fresh blank assistant every time.

## What Clawa adds

- **A home**: `AGENTS.md`, `CLAW.md`, `HUMAN.md`, `CLAWAS.md`, `CURIOUS.md`, `TOOLS.md`, and `pulses/`.
- **Onboarding**: first run starts a short conversational setup instead of an install wizard.
- **Memory**: shared SQLite memory plus recall over the current Clawa's own session files.
- **Subclawas**: specialist Clawas with their own homes and sessions, created when a real lane appears.
- **Pulses**: scheduled or manual wakes that run inside the owning Clawa session. No ghost chats.
- **Nested context**: small local `AGENTS.md` files are loaded when a Clawa works in that folder.
- **Bundled skills**: `clawa-ops`, `warmth-pass`, and `skill-creator`.

## How it operates

Clawa is meant to run as a long-lived Pi home.

- Run it inside herdr, tmux, or another persistent terminal environment.
- Use an always-on machine if pulses, Discord, or ambient behavior should keep running.
- After stopping, resume the same home with `pi -c` instead of starting fresh.
- Start a new session only when the branch is badly wedged or the compacted context has become too bloated.

Main Clawa sessions live in `.pi/sessions`. Subclawa sessions live under their own homes, for example `clawas/researcher/.pi/sessions`.

## Install from git

From the project folder:

```sh
curl -fsSL https://raw.githubusercontent.com/howaboua/pi-claw/main/scripts/install-project.sh | sh
```

Then start Pi from that folder.

The installer only writes `.pi/settings.json`. On first Pi start, Clawa bootstraps the home automatically. There is no `init` step.

If you prefer to write the settings file yourself:

```json
{
  "packages": ["git:github.com/howaboua/pi-claw"],
  "sessionDir": ".pi/sessions"
}
```

For now Clawa is expected to be installed from the git repo. Once npm publishing is ready, the package source can be swapped to `npm:@howaboua/pi-claw`.

## First run

Clawa creates missing home files in the project root:

| File | Purpose |
| --- | --- |
| `AGENTS.md` | load-bearing behavior spine, treated like system-prompt context |
| `CLAW.md` | identity, voice, temperament, taste |
| `HUMAN.md` | relationship map, preferences, human context |
| `CLAWAS.md` | sibling Clawas, lanes, and routing notes |
| `CURIOUS.md` | shiny rocks, motifs, sparks worth revisiting |
| `TOOLS.md` | local tools, services, commands, and gotchas |
| `pulses/` | scheduled and ambient wake folders plus a pulse index/journal |

The first bootstrap prompt includes a one-time privacy/security calibration worksheet. The worksheet is read from the installed package and is not copied into the home.

Clawa expects those core markdown files to be absent before first run. If one is already present, bootstrapping is blocked so the generated home shape stays clean. Move existing files out first, start Clawa, then ask your Clawa to adapt the generated files.

The boot state and subclawa worker definitions live in `.pi/claw.jsonc`.

## Subclawas

Subclawas are specialist Clawas, not default generic workers. The main Clawa creates one when a real lane appears: research, Discord, tech support, finance, jobs, or another focused surface.

Run `/claw`, choose **create clawa**, and describe the purpose. Clawa seeds a visible worker home under `clawas/`, links shared `HUMAN.md` and `CLAWAS.md`, registers the worker, and starts shaping the lane from there.

For agent-facing setup details, load the bundled `clawa-ops` skill.

## Pulses

Pulses are Clawa's scheduled wake layer. Each pulse is a named folder in a Clawa home, for example `pulses/weekly-pulse-review/PULSE.md`, with frontmatter for the schedule and a short tasklist in the body. Manual-only pulses use `schedule: manual`.

The scheduler sends a compact custom message into the owning Clawa session and tells it which pulse file to read. No ghost sessions: the pulse runs in a real main/subclawa conversation.

Use `/pulse` to open the pulse tab, or `/pulse run <id>` to run one directly.

## Memory

Clawa has shared memory tools:

- `remember` writes short home memories to project-local SQLite at `.pi/clawa-memory.sqlite`, shared by the main Clawa and all subclawas.
- `recall` searches that shared memory plus the current Clawa's own Pi session files. Session recall skips tool calls and tool results, and returns file/line/entry anchors when a deeper read is needed.

Use living docs for shaped truth. Use `remember` for small raw memories that should be easy to update or delete later.

## Optional Discord adapter — WIP

The Discord adapter lives in this repo at `packages/pi-clawa-discord/`. It is working, but still WIP: expect rough edges around setup copy, lifecycle, DMs, multi-channel behavior, and autonomy policy.

Until the adapter is published separately, use it from a local checkout:

```json
{
  "packages": [
    "git:github.com/howaboua/pi-claw",
    "/absolute/path/to/pi-claw/packages/pi-clawa-discord"
  ],
  "sessionDir": ".pi/sessions"
}
```

Then start Pi and run `/discord`.

The adapter creates project-local config at `.pi/clawa-discord/config.env`. Bot tokens stay local; do not commit `.pi/` secrets.

Detailed Discord setup lives in `packages/pi-clawa-discord/DISCORD-BOT-SETUP.md`.

## Notes

- Custom `.pi/SYSTEM.md` prompts are ignored by Clawa. Put compatible additions in `.pi/APPEND_SYSTEM.md` instead.
- Clawa keeps setup automatic. If first run is rough, fix the boot path rather than adding another setup command.
