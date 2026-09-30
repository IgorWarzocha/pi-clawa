---
name: clawa-vault
description: "Use when finding, adding, or curating durable knowledge in a Clawa home's shared memory."
---

All Clawas share the main home's `memory/`. Resolve the house from `PI_CLAW_PROJECT_ROOT` or the bootstrapped home with `.pi/claw.jsonc`. Do not create a worker-local copy. This skill retains its name so existing homes that load `clawa-vault` keep working.

Use `clawa_memory` to list, search, read, append, and write shared Markdown files. Its default scope
is `"memory"`; explicit `scope: "notes"` accesses retained per-chat checkpoints instead. Use
`clawa_history` for house archives and committed memory revisions. Pi owns compaction, or optional
Pi Codex owns its configured continuity. Generic `notes`, `history`, `new_context`, and
`get_context_remaining` are not Clawa tools; use them only when your continuity extension provides
them. `/memory` shows memory status. `/memory remember` freezes this conversation, starts a fresh
one, and queues optional consolidation. `/memory retry <jobId>` retries a failed job.

Start at `memory/index.md`, then search before creating another page. Keep one coherent subject per page, link related concepts instead of duplicating them, and update the index when a reader needs a route. Keep the human's shaped truth in `CLAW.md`, `HUMAN.md`, `CLAWAS.md`, `CURIOUS.md`, or `TOOLS.md` when that file owns it. Keep project-owned docs in the project. Do not warehouse transcripts, generic facts, secrets, or passing tasks in shared memory.

`memory/legacy/` contains deterministic Markdown files whose contents are exact JSON objects imported from the retired `.pi/clawa-memory.sqlite`. Each row preserves `id`, `ts`, `text`, and the original tags JSON string exactly; it is not an index of curated facts. Read and promote useful material rather than editing imported rows. Migration retains the old database as a read-only source and never overwrites conflicting memory files. Oversized rows stop import rather than being truncated. If migration reports a collision, resolve the conflicting paths deliberately before restarting.

Re-read shared targets before writing. Where Git history is available, `clawa_history` can list and read committed memory revisions; writing a file does not promise an automatic commit. Finish by reporting what changed and where it is now found.
