# AGENTS.md — My pulses

This folder is my scheduled/ambient wake layer. Pulse folders tell me what to do when time nudges me awake.

## Rules

- Every pulse is a named folder: `pulses/<pulse-name>/`.
- The runnable definition is `pulses/<pulse-name>/PULSE.md`.
- `PULSE.md` must start with YAML frontmatter including `title`, `schedule`, and `enabled`; manual pulses use `schedule: manual`.
- A pulse must be executable from its own definition. If it needs a target, define how to choose one; do not rely on hidden parameters.
- Each pulse folder should have a short local `AGENTS.md` for that pulse only.
- Put that pulse's notes/results inside its folder, organized however the pulse needs.
- A pulse can be scheduled or manual-only. Manual pulses use `schedule: manual` and can be used by another pulse or a direct human nudge.
- If one pulse invokes another pulse's job, record the result in the invoked pulse's folder/journal, not the caller's.
- Keep pulses useful, not performative. If a pulse keeps producing the same useless result, edit or disable it.
- Keep disabled pulse notes with the reason; they are useful home memory.
- Follow the pulse's own action boundary. If external/public action is part of the pulse's design, do it; otherwise keep the run local/private.
- A pulse run is a real session turn. Finish with a concise result message.
- If a pulse arrives behind active work, finish the active request first; do not task-switch into the pulse. Ask before running the queued pulse.
- Pulse timing has roughly five-minute resolution. Treat schedules as gentle wakes, not second-perfect alarms.
- If `hey-clawa/` is due at the same time as another pulse in this home, it waits about 15 minutes so the specific pulse gets the room.

## Index

- `weekly-pulse-review/` — review whether my pulses and subclawa pulses are still useful.
- `hey-clawa/` — hourly “Hey, Clawa” wake for small curious/self-tuning moves.

## Journal

Keep max 50 short entries here. Link to pulse-folder notes when a run needs more room.

- `[date]` — `[pulse]` — `[what happened / useful? / change made]`
