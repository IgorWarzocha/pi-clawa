---
title: Context, memory, and continuity
description: Find what belongs in the current window, private notes, shared memory, and history.
section: Core concepts
order: 40
---

Clawa keeps its living documents in the home. At session start, a bounded snapshot of `CLAW.md`,
`HUMAN.md`, `CLAWAS.md`, `CURIOUS.md`, and `TOOLS.md` joins the Pi branch. This is the current shape,
not a dump of everything the house knows.

## Notes, memory, and history

`notes` defaults to `scope: "notes"`: private Markdown checkpoints for this chat and agent under
`.pi/context/notes/`. Use `scope: "memory"` for files shared by all Clawas under `memory/`. List,
read, search, append, or write files. Keep shaped knowledge in those files and update the nearest
existing owner rather than creating duplicate pages. `memory/index.md` is the front door.

`history` reads Pi's canonical JSONL sessions through the house catalog at `.pi/context/chats/`.
Search prior windows, chats, and tools only when needed. It can also inspect committed revisions of
shared memory. The catalog is not a second transcript database and a write does not automatically
create a Git commit.

`memory/legacy/` holds Markdown files containing exact JSON objects with `id`, `ts`, `text`, and original
`tags` from the old SQLite memory database. Clawa imports existing rows on startup. It leaves the database intact as a
retired source and never creates one when none existed. Promote useful legacy material into shaped
pages instead of editing the imports. A row larger than the shared file limit stops import visibly
without truncating or changing the source database.

## A fresh window

The default `clawa.contextManagement: "local"` mode disables Pi's automatic threshold compaction
and checks context after completed tools and at settlement. Near 90% of the active model's context
it prompts a checkpoint. Save what the next window needs into notes, then call `new_context`. The new window
has no automatic summary; use notes and history to regain bearings. Failed or cancelled work does not
silently turn into a summary. `/memory` shows status. `/memory remember` queues a separate idle memory
pass; `/memory retry <jobId>` retries a failed job. The memory bot uses a fresh private Pi session.
It can edit only shared memory and the living-document owners, and leaves changes uncommitted.
“Remembered” means that run finished successfully, not that a model's judgment was independently verified.

Local rollover uses a native Pi boundary without a model-written summary and keeps the old JSONL
history. Pi's `/compact` and overflow recovery remain available as fallbacks. Choose
`clawa.contextManagement: "pi"` for Pi's usual compaction instead of Clawa's local rollover.
Notes, shared memory, and history work in either mode.

The practical rule is simple: current work stays in the window, checkpoints in private notes,
reusable knowledge in shared memory or living documents, and older conversations in history. Do not
turn transcripts into shared memory wholesale.
