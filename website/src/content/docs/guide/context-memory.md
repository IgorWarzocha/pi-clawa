---
title: Context, memory, and continuity
description: Find what belongs in the current window, private notes, shared memory, and history.
section: Core concepts
order: 40
---

Clawa keeps its living documents in the home. Before each agent turn, a bounded snapshot of
`CLAW.md`, `HUMAN.md`, `CLAWAS.md`, `CURIOUS.md`, and `TOOLS.md` joins Pi's native structured prompt.
The snapshot stays current after Pi compaction or optional Pi Codex continuity. It is the home's
current shape, not a dump of everything the house knows.

## Notes, memory, and history

`clawa_memory` defaults to `scope: "memory"`: Markdown shared by all Clawas under `memory/`.
Use explicit `scope: "notes"` for stored chat and agent checkpoints under `.pi/context/notes/`. List,
read, search, append, or write files. Keep shaped knowledge in those files and update the nearest
existing owner rather than creating duplicate pages. `memory/index.md` is the front door.

`clawa_history` reads Pi's canonical JSONL sessions through the house catalog at `.pi/context/chats/`.
Search prior windows, chats, and tools only when needed. It can also inspect committed revisions of
shared memory. The catalog is not a second transcript database and a write does not automatically
create a Git commit.

`memory/legacy/` holds Markdown files containing exact JSON objects with `id`, `ts`, `text`, and original
`tags` from the old SQLite memory database. Clawa imports existing rows on startup. It leaves the database intact as a
retired source and never creates one when none existed. Promote useful legacy material into shaped
pages instead of editing the imports. A row larger than the shared file limit stops import visibly
without truncating or changing the source database.

## Continuity belongs to Pi

Plain Pi owns compaction, including `/compact` and overflow recovery. Optional Pi Codex owns its
configured continuity. Clawa does not run a parallel rollover engine, disable Pi compaction, or
configure context thresholds. Generic `notes`, `history`, `new_context`, and
`get_context_remaining` are not Clawa tools. Use them only when your continuity extension provides
them. Old Clawa notes and window archives are retained and remain accessible through the house tools.

Shepherdr's own spawn flow and Codex sharing handle family context. Clawa does not add an adoption
API or another context-routing layer. A fresh home creates its files without starting an autonomous
turn, so Shepherdr can bind a child before its first task.

## Optional consolidation

`/memory` shows status. `/memory remember` freezes this conversation, starts a fresh one, and queues
optional idle consolidation. `/memory retry <jobId>` retries a failed job. The memory bot uses a
fresh private Pi session.
It can edit only shared memory and the living-document owners, and leaves changes uncommitted.
“Remembered” means that run finished successfully, not that a model's judgment was independently verified.

The practical rule is simple: current work stays in the window, checkpoints in private notes,
reusable knowledge in shared memory or living documents, and older conversations in history. Do not
turn transcripts into shared memory wholesale.
