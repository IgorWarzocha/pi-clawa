# TODO

## Replace the work-tracking lane

The extracted extension no longer carries the old work-tracking integration. It was too complex and too house-specific for this package.

Pick a simpler replacement for routing durable work between claws. Options are open:

- markdown files
- JSON/JSONL
- SQLite
- a tiny local task protocol
- something else, if it stays simple

Requirements for the replacement:

- easy to inspect and edit by hand
- local-first
- no hidden service dependency
- generic enough for any Clawa install
- small API for listing work, assigning work, and reporting status
- clean UI surface in `/claw` or the monitor widget later

## Replace JSONL memory storage with SQLite

Compaction now writes extracted durable memories to `.pi/clawa-memory.jsonl`.
That is intentionally simple for the first package pass.

Later, replace it with SQLite when the access pattern is clearer:

- stable ids
- timestamps and tags
- simple search/list/remove commands
- possible promotion into `MEMORY.md`
- no external service dependency
