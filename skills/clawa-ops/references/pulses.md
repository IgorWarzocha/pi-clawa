# Pulses

Pulses are scheduled Clawa wakes. They can be exact jobs, manual-only routines, or ambient nudges.

Every pulse is a named folder:

```text
pulses/
  AGENTS.md
  hey-clawa/
    AGENTS.md
    PULSE.md
  weekly-pulse-review/
    AGENTS.md
    PULSE.md
  curiosity-poke/
    AGENTS.md
    PULSE.md
    2026-06/
      notes.md
```

- `pulses/AGENTS.md` is the folder index and house-level pulse journal. It can hold up to ~50 short entries.
- `pulses/<pulse-name>/PULSE.md` is the runnable definition.
- `pulses/<pulse-name>/AGENTS.md` is a short local note for that one pulse.
- Extra notes/results live inside the relevant pulse folder, organized however that pulse needs.

Read `pulses/AGENTS.md` before creating or editing a pulse.

## Pulse file shape

Use frontmatter plus a body in `PULSE.md`:

`PULSE.md` must start with YAML frontmatter including `title`, `schedule`, and `enabled`. Manual pulses use `schedule: manual`; omitting `schedule` is unclear and invalid.

A pulse must be executable from its own definition. If it needs a target, the definition must say how to choose one. Do not create pulses that rely on hidden command parameters.

```md
---
title: Curiosity poke
schedule: manual
enabled: true
journal: pulses/AGENTS.md
---

# Curiosity poke

Pick one still-glowing thread from `CURIOUS.md` and make a small move: ask the human a good question, collect one useful note, or connect it to something already in the house.

Good result:

- one small useful note, question, or doc edit
- a short journal entry in `pulses/AGENTS.md`, linking deeper notes in this folder if needed
```

Supported schedules:

- `schedule: manual` — manual-only pulse
- `every 30m`
- `every 6h`
- `every 1d`
- `daily 09:00`
- `weekly mon 10:00`
- `at 2026-06-20T15:00:00Z`

## Managing pulses

Before adding a pulse:

1. Read `pulses/AGENTS.md`.
2. Check existing active and disabled pulses.
3. Consolidate if a similar pulse already exists.
4. Create `pulses/<pulse-name>/` with `PULSE.md` and short `AGENTS.md`.
5. Update the index and journal notes.

If one pulse performs another pulse's job, journal the result under the pulse whose job was performed. Example: if `hey-clawa/` chooses to run `curiosity-poke/`, the notes belong under `pulses/curiosity-poke/`, not under `pulses/hey-clawa/`.

If a pulse arrives while I am already doing something, it waits its turn. Finish the active human/clawa request first, then ask whether they want the queued pulse run now. Never task-switch away from live work just because a pulse fired.

Prefer disabling over deleting. A disabled pulse with a short reason preserves the lesson and helps challenge future similar ideas.

In `pulses/AGENTS.md`, keep:

- active pulse index
- disabled pulse notes: name + reason
- short run journal, max ~50 useful entries
- pruning/consolidation notes

Put bulky run notes in the relevant pulse folder and link them from the journal.

If a pulse repeatedly produces low-value work, edit it, merge it, or disable it with a reason.

The pulse definition is the action contract. If it is designed to post, send, buy, publish, or change an external surface, say that plainly in `PULSE.md` and execute it as part of the run. Do not invent extra approval gates unless the pulse itself, the human, or the house spine asks for them.
