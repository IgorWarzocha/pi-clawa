# Local context and memory

- Pi JSONL is the conversation authority. Window changes append native boundary drafts; never replace agent messages or rewrite another running session's JSONL.
- `files/` adapts Afreet's `src/extensions/bundled/context-management/memory/{files,storage,write-lock,revisions}.ts` as read on 2026-09-26. One explicit-root engine owns both house `memory/` and chat-local notes; only the latter are working checkpoints. Preserve the Linux no-follow/atomic/flock boundaries when changing the port.
- `history/` catalogs known house sessions and reads their native branches. No second transcript database or global history crawl.
- File versions are content hashes checked under the same OS lock as replacement. Consolidation requires them; ordinary notes retain explicit unconditional-write compatibility. Never compare versions outside the write lock.
- `consolidation/` freezes a source leaf before queueing. One house consumer owns queued → running → remembered/failed; interruption requeues, ordinary failure requires explicit retry. Its private model can touch only shared memory and this Clawa's living owners, not execute shell commands, load extensions, or commit files.
- Local rollover carries notes pointers and fresh living-home hydration, not an invented summary. Pi compaction remains the overflow escape hatch. Codex tool-name coexistence is intentionally outside this integration.
