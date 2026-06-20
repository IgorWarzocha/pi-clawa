# Pulses — agent operating note

Pulses are scheduled Clawa wakes. They cover exact jobs and ambient nudges without creating ghost conversations.

A pulse lives as a markdown file in a Clawa home:

```text
pulses/
  AGENTS.md
  weekly-pulse-review.md
  generic-wake.md
```

Subclawas may also have their own `pulses/` folders. The main Clawa coordinates scanning and dispatch.

## Definition shape

Use skill-like frontmatter plus a body:

```md
---
title: Weekly pulse review
schedule: weekly mon 10:00
enabled: true
---

# Weekly pulse review

Tasklist:

- Read `pulses/AGENTS.md`.
- Check whether recent pulses were useful or performative.
- Edit or disable obvious junk.
- Ask the human about taste/product decisions.

Good result:

- Short summary, concrete edits, and a journal note.
```

Supported schedules:

- `every 30m`, `every 6h`, `every 1d`
- `daily 09:00`
- `weekly mon 10:00`
- `at 2026-06-20T15:00:00Z`

## How a pulse runs

The scheduler sends a compact custom message into the owner Clawa session. That message tells the Clawa which definition file to read and execute.

This is not a hidden second chat. It is a real Clawa turn in the owning session. Replying to the result should go through the main Clawa, which can route onward if needed.

## Journal

Use `pulses/AGENTS.md` as the pulse folder index and short journal.

Keep it tidy:

- max ~50 short entries
- record what was useful or repetitive
- remove entries for stopped pulses once they no longer teach anything
- edit/disable pulses that keep producing low-value work

## External actions

A pulse may inspect and work locally by default. External/public actions need explicit permission in that pulse file.
