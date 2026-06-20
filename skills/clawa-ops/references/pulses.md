# Pulses

Pulses are scheduled Clawa wakes. They can be exact jobs or ambient nudges.
Some pulses are manual-only: they have no `schedule` and are invoked by another pulse or a direct house nudge.

Every Clawa can have its own pulse folder:

```text
pulses/
  AGENTS.md
  hey-clawa.md
  weekly-pulse-review.md
  manual/
    curiosity-poke.md
  2026-06/
    run-notes.md
```

`pulses/AGENTS.md` is the local pulse index and journal. Keep it short and snappy. Read it before creating or editing a pulse.

Organize supporting notes/results by date, pulse name, or purpose. Do not dump every file loose into `pulses/`.

## Pulse file shape

Use frontmatter plus a body:

```md
---
title: Curiosity poke
schedule: every 2d
enabled: true
journal: pulses/AGENTS.md
---

# Curiosity poke

Pick one still-glowing thread from `CURIOUS.md` and make a small move: ask the human a good question, collect one useful note, or connect it to something already in the house.

Good result:

- one small useful note, question, or doc edit
- a short journal entry in `pulses/AGENTS.md`
```

Runnable pulse definitions need frontmatter with `title`. Ordinary notes/results without frontmatter can live under `pulses/` without becoming runnable pulses.

Supported schedules:

- no `schedule` — manual-only pulse
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
4. Create the smallest pulse that could work.
5. Add/update the index and journal notes.

If one pulse performs another pulse's job, journal the result under the pulse whose job was performed. Example: if `hey-clawa.md` chooses to run a manual `curiosity-poke.md`, the journal entry belongs to `curiosity-poke.md`.

Prefer disabling over deleting. A disabled pulse with a short reason preserves the lesson and helps challenge future similar ideas.

In `pulses/AGENTS.md`, keep:

- active pulse index
- disabled pulse notes: name + reason
- short run journal, max ~50 useful entries
- pruning/consolidation notes

Put bulky run notes in dated or pulse-specific files/folders and link them from the journal.

If a pulse repeatedly produces low-value work, edit it, merge it, or disable it with a reason.

If a pulse should post, send, buy, publish, or change an external surface, say that plainly in the pulse file.
