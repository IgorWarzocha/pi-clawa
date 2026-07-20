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

- `pulses/AGENTS.md` is the folder index and home-level pulse journal. It can hold up to ~50 short entries.
- `pulses/<pulse-name>/PULSE.md` is the runnable definition.
- `pulses/<pulse-name>/AGENTS.md` is a short local note for that one pulse.
- Extra notes/results live inside the relevant pulse folder, organized however that pulse needs.

Use the already-loaded pulse context before creating or editing a pulse; inspect files only when you are actually changing them.

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

Pick one still-glowing thread from `CURIOUS.md` and make a small move: ask the human a good question, collect one useful note, or connect it to something already in the home.

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

Pulse timing has roughly five-minute resolution. Treat schedules as gentle wakes, not second-perfect alarms.
If `hey-clawa` is due in the same scan as another pulse for the same Clawa, it is delayed by about 15 minutes so the ambient wake does not crowd the more specific pulse.

Optional `quietHours: HH:MM-HH:MM` suppresses scheduled wakes during that local-time window. Overnight windows such as `23:00-08:00` and daytime windows such as `13:00-14:00` both work; the start is included and the end is excluded. A due pulse waits and runs once after quiet hours instead of being discarded. Manual `/pulse run` bypasses quiet hours. Every dispatched pulse includes its local wake date, time, UTC offset, and timezone in the instruction.

```yaml
quietHours: 23:00-08:00
```

## Managing pulses

Before adding a pulse:

1. Check existing active and disabled pulses.
2. Check the current pulse index/journal shape.
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

The pulse definition is the action contract. If it is designed to post, send, buy, publish, or change an external surface, say that plainly in `PULSE.md` and execute it as part of the run. Do not invent extra approval gates unless the pulse itself, the human, or the home spine asks for them.
