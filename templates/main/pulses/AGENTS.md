# AGENTS.md — My pulses

This folder is my scheduled/ambient wake layer. Pulse folders tell me what to do when time nudges me awake.

## Rules

- Every pulse is a named folder: `pulses/<pulse-name>/`.
- The runnable definition is `pulses/<pulse-name>/PULSE.md`.
- Each pulse folder should have a short local `AGENTS.md` for that pulse only.
- Put that pulse's notes/results inside its folder, organized however the pulse needs.
- A pulse can be scheduled or manual-only. Manual pulses have no `schedule` and can be used by another pulse or a direct human nudge.
- If one pulse invokes another pulse's job, record the result in the invoked pulse's folder/journal, not the caller's.
- Keep pulses useful, not performative. If a pulse keeps producing the same useless result, edit or disable it.
- Keep disabled pulse notes with the reason; they are useful house memory.
- External/public actions must be explicitly allowed in that pulse file.
- A pulse run is a real session turn. Finish with a concise result message.

## Index

- `weekly-pulse-review/` — review whether my pulses and subclawa pulses are still useful.
- `hey-clawa/` — hourly “Hey, Clawa” wake for small curious/self-tuning moves.

## Journal

Keep max 50 short entries here. Link to pulse-folder notes when a run needs more room.

- `[date]` — `[pulse]` — `[what happened / useful? / change made]`
