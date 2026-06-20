# Clawa for Pi

Clawa is a Pi package that turns a project folder into a small agent home.

It keeps Pi's normal tools and system prompt, then adds a warmer Clawa posture, first-run home files, Clawas worker orchestration, nested `AGENTS.md` loading, and a few bundled skills.

## Install in a project

From the project folder:

```sh
curl -fsSL https://raw.githubusercontent.com/howaboua/pi-claw/main/scripts/install-project.sh | sh
```

Then start Pi from that folder.

The installer only writes `.pi/settings.json`. On first Pi start, Clawa bootstraps the home automatically. There is no `init` step.
Main Clawa sessions are stored project-locally in `.pi/sessions`.

If you prefer to write the settings file yourself:

```json
{
  "packages": ["git:github.com/howaboua/pi-claw"],
  "sessionDir": ".pi/sessions"
}
```

For now Clawa is expected to be installed from the git repo. Once npm publishing is ready, the package source can be swapped to `npm:@howaboua/pi-claw`.

Clawa works best as a long-lived Pi home:

- run it inside herdr, tmux, or another persistent terminal environment
- use an always-on machine if pulses, Discord, or ambient behavior should keep running
- after stopping, resume the same home with `pi -c` instead of starting a fresh session
- start a new session only when the branch is badly wedged or the compacted context has become too bloated

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

The first bootstrap prompt also includes a one-time privacy/security calibration worksheet. The worksheet is read from the installed package and is not copied into the home.

Clawa expects those core markdown files to be absent before first run. If one is already present, bootstrapping is blocked so the generated home shape stays clean. Move existing files out first, start Clawa, then ask your claw to adapt the generated files.

The boot state lives in `.pi/claw.jsonc`.

## Clawas workers

Subclaws are specialized helpers, not default generic workers. The main Clawa creates one when a real lane appears: research, Discord, tech support, finance, jobs, or another focused surface.

Run `/claw`, choose **create clawa**, and describe the purpose. Clawa seeds a visible worker home under `clawas/`, links shared `HUMAN.md` and `CLAWAS.md`, registers the worker, and asks the main Clawa/new Clawa to shape the lane from there.

Each subclaw keeps its own Pi sessions under its home: `clawas/<name>/.pi/sessions`.

## Pulses

Pulses are Clawa's scheduled wake layer. Each pulse is a named folder in a Clawa home, for example `pulses/weekly-pulse-review/PULSE.md`, with frontmatter for the schedule and a short tasklist in the body. Manual-only pulses use `schedule: manual`.

The scheduler sends a compact custom message into the owning Clawa session and tells it which pulse file to read. No ghost sessions: the pulse runs in a real main/subclawa conversation.

Use `/pulse` to open the pulse tab, or `/pulse run <id>` to run one directly.

## Memory

Clawa has shared memory tools:

- `remember` writes short home memories to project-local SQLite at `.pi/clawa-memory.sqlite`, shared by the main Clawa and all subclaws.
- `recall` searches that shared memory plus the current Clawa's own Pi session files. Session recall skips tool calls and tool results, and returns file/line/entry anchors when a deeper read is needed.

Use living docs for shaped truth. Use `remember` for small raw memories that should be easy to update or delete later.

## Nested context

Clawa watches navigation tools. When a claw reads or searches inside a folder with local `AGENTS.md` files, those local instructions are appended to the relevant tool result.

Use short nested `AGENTS.md` files for local rules, traps, ownership, or routing. Usually 1–10 lines is enough.

## Bundled skills

This package bundles:

- `clawa-ops`
- `warmth-pass`
- `skill-creator`

Pi discovers them from the package `skills/` directory.

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
- Clawa boot state and subclawa worker definitions live in `.pi/claw.jsonc`.
- Clawa keeps setup automatic. If first run is rough, fix the boot path rather than adding another setup command.
