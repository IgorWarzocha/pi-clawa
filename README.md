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

If you prefer to write the settings file yourself:

```json
{
  "packages": ["npm:@howaboua/pi-claw"]
}
```

## First run

Clawa creates missing home files in the project root:

| File | Purpose |
| --- | --- |
| `AGENTS.md` | load-bearing behavior spine, treated like system-prompt context |
| `CLAW.md` | identity, voice, temperament, taste |
| `HUMAN.md` | relationship map, preferences, human context |
| `CURIOUS.md` | shiny rocks, motifs, sparks worth revisiting |
| `TOOLS.md` | local tools, services, commands, and gotchas |
| `PRIVACY.md` | one-time privacy/security calibration worksheet |

Clawa expects those core markdown files to be absent before first run. If one is already present, bootstrapping is blocked so the generated home shape stays clean. Move existing files out first, start Clawa, then ask your claw to adapt the generated files.

The boot state lives in `.pi/claw.jsonc`.

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
