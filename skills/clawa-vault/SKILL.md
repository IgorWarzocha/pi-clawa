---
name: clawa-vault
description: "Use when finding, adding, or curating durable knowledge in a Clawa home's shared memory."
---

All Clawas share the main home's `memory/`. Resolve the house from `PI_CLAW_PROJECT_ROOT` or the bootstrapped home with `.pi/claw.jsonc`. Do not create a worker-local copy. This skill retains its name so existing homes that load `clawa-vault` keep working.

Use the native `notes` tool with `scope: "memory"` to list, search, read, append, and write Markdown files. Use `history` when the question concerns a past window, chat, or committed memory revision. Use `notes` with its default `scope: "notes"` for per-chat checkpoints, not shared knowledge. `new_context` starts a fresh window after checkpointing; it does not summarize automatically. `/memory` shows context status, starts background consolidation with `/memory remember`, and retries a failed job with `/memory retry <jobId>`.

Start at `memory/index.md`, then search before creating another page. Keep one coherent subject per page, link related concepts instead of duplicating them, and update the index when a reader needs a route. Keep the human's shaped truth in `CLAW.md`, `HUMAN.md`, `CLAWAS.md`, `CURIOUS.md`, or `TOOLS.md` when that file owns it. Keep project-owned docs in the project. Do not warehouse transcripts, generic facts, secrets, or passing tasks in shared memory.

`memory/legacy/` contains deterministic Markdown files whose contents are exact JSON objects imported from the retired `.pi/clawa-memory.sqlite`. Each row preserves `id`, `ts`, `text`, and the original tags JSON string exactly; it is not an index of curated facts. Read and promote useful material rather than editing imported rows. Migration retains the old database as a read-only source and never overwrites conflicting memory files. Oversized rows stop import rather than being truncated. If migration reports a collision, resolve the conflicting paths deliberately before restarting.

Re-read shared targets before writing. Where Git history is available, `history` can list and read committed memory revisions; writing a file does not promise an automatic commit. Finish by reporting what changed and where it is now found.
