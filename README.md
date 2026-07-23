# Clawa for Pi

**[Documentation](https://igorwarzocha.github.io/pi-clawa/)** ·
**[Changelog](CHANGELOG.md)** ·
**[Releases](https://github.com/IgorWarzocha/pi-clawa/releases)**

Clawa is my spin on OpenClaw/Hermes-style personal agents in an attempt to make the Clankers speak hooman, built as a thin-ish Pi extension.

OpenClaw and Hermes both come with all the batteries included. Some say too many. Some, like me, would prefer something more barebones that you can add to yourself. Clawa keeps raw Pi underneath — your models, tools, extensions, terminal — and adds basically the same things as the bigger cousins.

It is intentionally not a giant bundle. Clawa does not ship dozens of adapters, example agents, plugins, or skills. If you need more, ask Pi to extend itself like normal, or install a package from [pi.dev/packages](https://pi.dev/packages) - it there are many extensions that already connect to various platforms.

I made GPT 5.4 lose its robotic tone of voice. This works. Just trust me, bro.

## How Clawa operates

Clawa changes the shape of a Pi session without taking Pi away.

- It swaps the top of Pi's default system prompt for Clawa posture, while keeping the rest of it intact.
- `AGENTS.md` is the core behavior spine; Clawa relies mostly on it, not dozens of other files.
- Clawa instruction context is home-contained: Pi's global and outside-parent `AGENTS.md`/`CLAUDE.md` files are excluded, while files inside the active Clawa home still apply. Ordinary Pi sessions are unchanged.
- The other living docs are hydrated after session start and after compaction. This applies to `CLAW.md`, `HUMAN.md`, `CLAWAS.md`, `CURIOUS.md`, and `TOOLS.md`, bounded at 8,000 characters per file and 24,000 characters total.
- Nested `AGENTS.md` files progressively disclose local folder rules when a Clawa works there - based on bash detection. They are instructed to create them for folders. This keeps context lean.
- Custom `.pi/SYSTEM.md` prompts are ignored by Clawa to keep things simple. Put compatible additions in this home's `.pi/APPEND_SYSTEM.md` instead. The Clawa system-prompt swap lives in [`src/system-prompt.ts`](src/system-prompt.ts): it replaces Pi's default assistant intro with the Clawa personal-assistant intro while keeping Pi's tool/runtime context intact.

## The home files

On first run, Clawa creates a familiar set of markdown files with a few twists. The package includes ready-made templates for them.

| File | Purpose |
| --- | --- |
| `AGENTS.md` | hard behavior spine and home principles - loaded with every message |
| `CLAW.md` | identity, voice, temperament, taste (`SOUL.md` + `IDENTITY.md` in one file) |
| `HUMAN.md` | relationship map, preferences, private human context (`USER.md`) |
| `CLAWAS.md` | agent-facing routing map for sibling Clawas |
| `CURIOUS.md` | live sparks, motifs, sidequests worth revisiting (key difference between this and other implementations) |
| `TOOLS.md` | local tools, services, commands, and gotchas |
| `vault/` | shared shaped knowledge and its front-door index |
| `pulses/` | skill-like scheduled/manual wake folders: frontmatter + body |

An optional root-level `CLAWA.png`, `.jpg`, `.jpeg`, `.webp`, or `.gif` becomes a bounded visual identity card for image-capable models.

Subclawas inherit the main Clawa's root `AGENTS.md` principles, then add their own smaller local `AGENTS.md`. They share `HUMAN.md` and `CLAWAS.md` through symlinks, but keep their own `CLAW.md`, `CURIOUS.md`, `TOOLS.md`, sessions, and pulses.

## First run and onboarding

Start Clawa in a clean folder. Do not copy an existing OpenClaw/Hermes home directly into it; the shape is different.

If you already have an OpenClaw or Hermes installation, point Clawa at those files during onboarding and ask it to import what makes sense. The bundled `clawa-ops` skill includes guidance for previewing what can be imported, what should be summarized, and what should be skipped.

The first run starts a short conversational onboarding. Clawa establishes its name/shape, learns enough about the human to stop freezing, and calibrates privacy/security in normal chat. It will stop when either of you gets bored of onboarding and tell you what to do next.

## Subclawas

Subclawas are specialist Clawas, created when a real lane appears: research, Discord, tech support, finance, job hunting, a public surface, or some other focused domain.

Normally you keep talking to the main Clawa. It can create subclawas, message them, route work, collect replies, and keep the home coherent. If you need to work directly with one, `/jump` opens its own Pi session; `/steer` nudges the active or named Clawa without taking over the whole home.

Run `/claw` to inspect and manage Clawas. The main Clawa may also suggest creating a subclawa when it notices a specialized lane that deserves its own home.

## Pulses

Pulses are Clawa's scheduled/ambient wake layer: a softer hybrid of cron and heartbeat.

Each pulse is a named folder in a Clawa home, for example `pulses/weekly-pulse-review/PULSE.md`. The definition is markdown with frontmatter (`title`, `schedule`, `enabled`) and a body that tells the Clawa what the wake is for. Manual-only pulses use `schedule: manual` - tell your Clawa to trigger it... Or it might trigger it automatically during `hey-clawa`.

Pulse instructions always state their local wake date, time, UTC offset, and timezone. Add optional `quietHours: 23:00-08:00` to a pulse when scheduled wakes should sleep through a local-time window; manual runs still work.

The default home includes:

- `hey-clawa/` — every 30 minutes, asks Clawa to make one small useful or interesting move.
- `weekly-pulse-review/` — reviews whether pulses are helping or becoming performative.

Pulse runs are observable: they are custom messages inside the owning main/subclawa session, not invisible background agents you cannot find later. Use `/pulse` to open the pulse tab, or `/pulse run <id>` to run one directly.

`hey-clawa` is kinda like heartbeat, but as you might have noticed, there is not `HEARTBEAT.md`. This file made heartbeats stale. In my experience, agents have a weird preference for what to run, and it's mostly diagnostic/cleanup/etc. This prevents it. There is also a pulse log in `/pulses/AGENTS.md` so Clawas know what was run and will choose a less recent pulse.

## Memory

Clawa has two memory lanes:

- SQLite memory at `.pi/clawa-memory.sqlite`, shared by the main Clawa and all subclawas.
- Session recall over the current Clawa's own Pi session files.

The `recall` tool searches both at once and returns anchors when the Clawa needs to read deeper. Tool calls and tool results are skipped. The `remember` tool is for small raw memories that should be easy to update or delete later.

Living docs are still where shaped truth belongs.

## Compaction

Clawa hooks Pi's normal compaction and runs a Clawa-shaped continuity pass with the active Pi model. There is no separate compaction model or extra model config.

The Clawa compaction asks for two things:

- a compact continuity summary for future-Clawa after context loss
- 0-3 small memory lines worth storing in `.pi/clawa-memory.sqlite`

It is intentionally not a ticket ledger. It should preserve live decisions, tone, corrections, relationship texture, curiosity sparks, and the next useful move — not stale completed-work recaps.

Every Clawa, including Discord and other subclawas, also compacts quietly after a settled turn once its active model reaches 80% context usage. The threshold follows the model instead of assuming one universal token window. Compaction does not manufacture a continuation turn: the next real message or pulse resumes from the continuity summary. Override or disable the settled policy in `.pi/claw.jsonc` when a home needs another shape:

```jsonc
{
  "clawa": {
    "compaction": {
      "auto": true,
      "triggerPercent": 80
    }
  }
}
```

The continuity summary remains bounded by Pi's active compaction reserve. Ordinary tool chatter is culled; Clawa-to-Clawa notes and their delivery result remain as relationship and handoff context.

After `/compact`, Clawa rehydrates the living docs on the next turn so it wakes back up with the home shape in context again.

## Running it well

Clawa is meant to run as a long-lived Pi home.

- Run it inside herdr, tmux, or another persistent terminal environment.
- Use an always-on machine and keep a UI-bearing main Pi session running if pulses, managed Clawas, Discord, or ambient behavior should keep running.
- After stopping, resume the same home with `pi -c` instead of starting fresh.
- Start a new session only when the branch is badly wedged or the compacted context has become too bloated.

Main Clawa sessions use Pi's normal session store, so `pi -c` and `pi -r` behave like standard Pi. Subclawa sessions live under their own homes, for example `clawas/researcher/.pi/sessions`.

If you have global Pi extensions you do not want in this Clawa home, adjust project `.pi/settings.json` instead of changing global settings. Pi package filters can disable package resources for this project only; Clawa's `clawa-ops` skill has notes for helping with that.

## Recommended install

Keep the package checkout separate from the clean folder that will become the Clawa home. Tagged releases are the stable update channel; `master` collects the next batch.

```sh
git clone --branch v0.1.0 --depth 1 https://github.com/IgorWarzocha/pi-clawa.git
cd /path/to/your-clawa-home
pi -e /absolute/path/to/pi-clawa
```

Once `.pi/settings.json` points at the checkout, come back to the same home with plain Pi:

```sh
pi -c
```

If something feels clearly broken or confusing, open an issue on GitHub with what you expected, what happened, and any relevant Clawa home shape. Do not include `.pi/` secrets.

## Project settings install

If you want the home to remember the local checkout path, run the helper from your desired Clawa home:

```sh
/absolute/path/to/pi-clawa/scripts/install-project.sh
```

Then start Pi from that folder.

The helper only writes `.pi/settings.json`. On first Pi start, Clawa bootstraps the home automatically. There is no `init` step.

If you prefer to write the settings file yourself:

```json
{
  "packages": ["/absolute/path/to/pi-clawa"]
}
```

For now Clawa is expected to be run from a cloned repo. Once npm publishing is ready, the package source can be swapped to `npm:@howaboua/pi-clawa`.

Full installation, first-run, privacy, upgrade, and troubleshooting guidance lives in the **[documentation](https://igorwarzocha.github.io/pi-clawa/)**.

## Bundled skills

Clawa bundles four skills:

- `clawa-ops` — agent-facing home operations: subclawas, pulses, config, imports.
- `warmth-pass` — keeps Clawa docs/prompts from sliding back into flat assistant voice.
- `skill-creator` — helps create or tune skills when the home needs one.
- `clawa-vault` — keeps the shared second brain shaped, linked, and navigable.

These are not a giant skill library. They are the minimum needed for Clawa to operate and improve its own home. Warmth pass is the key component of making Clawas speak hooman - they are instructed to use it for everything they write.

## Optional Discord adapter — WIP

The Discord adapter lives in this repo at `packages/pi-clawa-discord/`. It works, but it is still WIP: setup polish, lifecycle behavior, and multi-channel taste are still being shaped.

Until the adapter is published separately, use it from a local checkout:

```json
{
  "packages": [
    "/absolute/path/to/pi-clawa",
    "/absolute/path/to/pi-clawa/packages/pi-clawa-discord"
  ]
}
```

Then start Pi and run `/discord`.

The adapter creates project-local config at `.pi/clawa-discord/config.env`. Discord routes live in `.pi/clawa-discord/routes.jsonc`, using names like `dm` and `#howaclawa`; the gateway resolves those names to Discord ids. Bot tokens stay local; do not commit `.pi/` secrets.

Detailed Discord setup lives in `packages/pi-clawa-discord/DISCORD-BOT-SETUP.md`.

Attribution: this adapter started from **Crokily/pi-discord-gateway** / **Piscord**. The upstream MIT license names **patchfx** as copyright holder; both the source repo and license credit are kept in the adapter package. It has since been heavily reshaped around how I wanted my Clawa to behave. The gateway architecture also keeps a small nod to NanoClaw for the Discord → queue → agent → Discord relay pattern.
