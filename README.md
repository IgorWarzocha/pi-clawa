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
  "packages": ["npm:@howaboua/pi-claw"],
  "sessionDir": ".pi/sessions"
}
```

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
| `pulses/` | scheduled and ambient wake definitions plus a short pulse journal |

The first bootstrap prompt also includes a one-time privacy/security calibration worksheet. The worksheet is read from the installed package and is not copied into the home.

Clawa expects those core markdown files to be absent before first run. If one is already present, bootstrapping is blocked so the generated home shape stays clean. Move existing files out first, start Clawa, then ask your claw to adapt the generated files.

The boot state lives in `.pi/claw.jsonc`.

## Clawas workers

Subclaws are specialized helpers, not default generic workers. The main Clawa creates one when a real lane appears: research, Discord, tech support, finance, jobs, or another focused surface.

Run `/claw`, choose **create clawa**, and describe the purpose. Clawa seeds a visible worker home under `clawas/`, links shared `HUMAN.md` and `CLAWAS.md`, registers the worker, and asks the main Clawa/new Clawa to shape the lane from there.

Each subclaw keeps its own Pi sessions under its home: `clawas/<name>/.pi/sessions`.

## Pulses

Pulses are Clawa's scheduled wake layer. A pulse is a markdown definition in a Clawa home, for example `pulses/weekly-pulse-review.md`, with frontmatter for the schedule and a short tasklist in the body.

The scheduler sends a compact custom message into the owning Clawa session and tells it which pulse file to read. No ghost sessions: the pulse runs in a real main/subclawa conversation.

Use `/pulse list` to inspect enabled pulses and `/pulse run <id>` to run one now.

## Memory

Clawa has shared memory tools:

- `remember` writes short house memories to project-local SQLite at `.pi/clawa-memory.sqlite`, shared by the main Clawa and all subclaws.
- `recall` searches that shared memory plus the current Clawa's own Pi session files. Session recall skips tool calls and tool results, and returns file/line/entry anchors when a deeper read is needed.

Use living docs for shaped truth. Use `remember` for small raw memories that should be easy to update or delete later.

## Nested context

Clawa watches navigation tools. When a claw reads or searches inside a folder with local `AGENTS.md` files, those local instructions are appended to the relevant tool result.

Use short nested `AGENTS.md` files for local rules, traps, ownership, or routing. Usually 1–10 lines is enough.

## Bundled skills

This package bundles:

- `warmth-pass`
- `skill-creator`

Pi discovers them from the package `skills/` directory.

## Optional Discord adapter

To install Clawa plus Discord support, use project settings like:

```json
{
  "packages": ["npm:@howaboua/pi-claw", "npm:@howaboua/pi-claw-discord"]
}
```

Then start Pi and run `/discord`.

The adapter creates project-local config at `.pi/claw-discord/config.env`. Bot tokens stay local; do not commit `.pi/` secrets.

Detailed Discord setup lives in `packages/pi-claw-discord/DISCORD-BOT-SETUP.md`.

## Notes

- Custom `.pi/SYSTEM.md` prompts are ignored by Clawa. Put compatible additions in `.pi/APPEND_SYSTEM.md` instead.
- Worker definitions live in `.pi/clawas/config.jsonc`.
- Clawa keeps setup automatic. If first run is rough, fix the boot path rather than adding another setup command.
