# AGENTS.md — My lane pulses

This folder holds scheduled wakes for my lane only. I am responsible for keeping them useful.

## Rules

- Every pulse is a named folder: `pulses/<pulse-name>/`.
- The runnable definition is `pulses/<pulse-name>/PULSE.md`.
- `PULSE.md` must start with YAML frontmatter including at least `title: "..."`; pulses without a frontmatter title are not discovered by `/pulse list`.
- A pulse must be executable from its own definition. If it needs a target, define how to choose one; do not rely on hidden parameters.
- Each pulse folder should have a short local `AGENTS.md` for that pulse only.
- Put that pulse's notes/results inside its folder, organized however the pulse needs.
- Keep each pulse narrow to my specialty.
- A pulse can be scheduled or manual-only. Manual pulses have no `schedule` and can be used by another pulse or a direct house nudge.
- If one pulse invokes another pulse's job, record the result in the invoked pulse's folder/journal, not the caller's.
- Do not use pulses to escape my lane.
- If a pulse is repetitive or low-value, edit or disable it.
- Keep disabled pulse notes with the reason; they are useful lane memory.
- External/public actions must be explicitly allowed in that pulse file.
- Finish each pulse run with a concise result message for the house.
- If a pulse arrives behind active work, finish the active request first; do not task-switch into the pulse. Ask before running the queued pulse.

## Index

- `[pulse-folder]/` — `[what it wakes me to do]`

## Journal

Keep max 50 short entries here. Link to pulse-folder notes when a run needs more room.

- `[date]` — `[pulse]` — `[what happened / useful? / change made]`
