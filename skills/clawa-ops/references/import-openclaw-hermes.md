# Import OpenClaw or Hermes into Clawa

Use this when the human says something like: “import my OpenClaw/Hermes environment from this folder.”

This is not a raw migration. Treat the old environment as source material, then shape it into the Clawa house: living docs, `.pi/claw.jsonc`, subclawas, pulses, and tool notes.

## First move

1. Identify the source folder and kind.
   - OpenClaw usually has `openclaw.json` and OpenClaw state/config folders.
   - Hermes usually has `config.yaml`, `.env`, `SOUL.md`, `memories/USER.md`, or `memories/MEMORY.md`.
   - Hermes profiles are separate homes; pick the profile/source the human meant.
2. Ask what they want carried over if scope is unclear: identity/taste, human preferences, channels, scheduled wakes, skills/tools, subagents, or all reasonable context.
3. Inspect config and living docs first. Do not start by reading sessions, logs, databases, or huge history files.
4. Before editing, give the human a short import readout:
   - what source files were found
   - what can import cleanly
   - what can only be summarized/adapted
   - what should be skipped unless they explicitly want history recovery
   - any taste choices needed before shaping names, channels, or pulses
5. Then import by editing Clawa files. Do not copy old runtime folders wholesale.

## Clawa targets

- `CLAW.md` — identity, voice, temperament, self-shape.
- `HUMAN.md` — human preferences, relationship context, useful private context.
- `CURIOUS.md` — live sparks and sidequests with charge.
- `TOOLS.md` — useful installed tools, commands, MCP/services, channel/gateway notes.
- `.pi/claw.jsonc` — Clawa defaults and subclawa workers.
- `CLAWAS.md` — agent-facing routing map for subclawas.
- `pulses/<name>/PULSE.md` — scheduled/manual wakes.
- `pulses/AGENTS.md` — pulse index, disabled notes, short journal.

Load `configuration.md`, `subclawas-setup.md`, or `pulses.md` before touching those parts.

## Hermes mapping

Hermes home is profile-scoped. Look for:

- `config.yaml` — models, tools, gateway, cron, profiles, plugins, skill config.
- `.env` — secrets only. Do not paste secrets into markdown; keep them in local config/env if still needed.
- `SOUL.md` — usually maps into `CLAW.md`.
- `memories/USER.md` — usually maps into `HUMAN.md`.
- `memories/MEMORY.md` — extract useful shaped memory; do not recreate `MEMORY.md`.
- `skills/` / `optional-skills/` — note reusable tools/workflows in `TOOLS.md`; only copy or port skills when they are actually compatible and wanted.
- `cron/jobs.json` — convert useful recurring jobs into pulse folders. Use `schedule: manual` for manual routines; exact schedules become `schedule: ...`.
- gateway/home-channel config — map to channel Clawa notes, Discord adapter setup, or `TOOLS.md`; do not assume every old channel should be enabled.
- `sessions/`, logs, state DBs, backups — skip by default. Search them only when the human asks for history recovery.

Hermes subagents are usually behavior/capability, not a folder of people. Create subclawas only for recurring specialist lanes, not every old toolset.

## OpenClaw mapping

OpenClaw config is usually JSON5. Look for:

- `openclaw.json` — agents, channels, models, heartbeat, skills, MCP, plugins, sessions.
- agent defaults/list/multi-agent config — map recurring agents into subclawas via `subclawas-setup.md`.
- identity/context/memory files — fold useful parts into `CLAW.md`, `HUMAN.md`, `CURIOUS.md`, `TOOLS.md`, or `remember`.
- heartbeat config or `HEARTBEAT.md` — map into `Hey, Clawa` or a named pulse. Do not recreate `HEARTBEAT.md`.
- cron/scheduled jobs — map into pulse folders, preserving intent and cadence.
- channel config — map only chosen surfaces. Discord should go through the Clawa Discord adapter shape, not copied OpenClaw channel config.
- MCP/skills/plugins — note in `TOOLS.md` and install/configure deliberately if still useful.
- runtime SQLite/state/session/log files — do not copy into Clawa. Use them only as evidence if the human explicitly wants history imported.

OpenClaw agents may have richer routing than Clawa needs. Prefer fewer, obvious subclawas with warm onboarding over a literal one-to-one import.

## Import style

- Keep the human in the loop for taste calls: names, which old agents survive, which channels matter, and which schedules should keep waking the house.
- Preserve useful identity/context; leave old platform machinery behind.
- Convert schedules into pulses that are self-contained and agentic.
- Convert recurring specialist agents into subclawas and onboard them properly.
- Keep secrets out of markdown.
- After structural edits, run `scripts/doctor.py` from this skill.

## Good finish

End with a short import note:

- what source folder was used
- what was imported
- what was intentionally skipped
- what needs human choice later
- whether doctor passed
