---
title: Context, memory, and continuity
description: See where current context, raw memory, recall, and compaction each belong.
section: Core concepts
order: 40
---

Clawa has four continuity mechanisms. They overlap just enough to hand work from one timescale to
another, but they are not interchangeable.

## Hydration: the current shape

At session start, Clawa builds one hidden hydration message from five living files and persists it in
the branch without triggering a turn. After Pi compacts, Clawa refreshes that message only when the
same payload is no longer active. Provider continuation and native compaction therefore see the same
model-visible history rather than a separate extension-only overlay.

Limits are intentionally hard:

- 8,000 characters per file;
- 24,000 characters across the block;
- only `CLAW.md`, `HUMAN.md`, `CLAWAS.md`, `CURIOUS.md`, and `TOOLS.md`;
- an optional bounded `CLAWA` image.

Hydration is a snapshot of shaped truth. It does not inject the SQLite memory database.

## `remember`: small raw memory

The `remember` tool creates, updates, and deletes short notes in `.pi/clawa-memory.sqlite`. The
database is shared by the main Clawa and workers through the project root.

Memories have numeric IDs and up to 12 normalized tags. Passing an ID updates that memory; passing
an ID with empty text deletes it. The tool is meant for texture and sparks that matter but do not yet
deserve a living-document edit.

## `recall`: explicit search

`recall` searches both shared SQLite memory and up to five recent Pi session files discovered for the
current Clawa. It returns memory IDs for edits and file/line anchors for session matches. Recent
no-query memory recall takes a direct bounded database path; session files are streamed and only the
strongest bounded result set is retained. Session search skips tool calls and tool results, which
reduces noise and avoids treating command output as remembered human intent.

Recall is normally explicit, not ambient. The model should search when prior preference or a decision
may matter, not on every turn. The one lifecycle exception is the deliberate memory pass near
compaction. During first-run onboarding recall is specifically discouraged unless you ask or the
session is resuming after compaction.

## Memory pass and compaction

Pi's configured default, custom, or provider-native compactor carries the canonical session branch.
Clawa does not replace or merge that result. Pi cannot compose competing compaction summaries, so
there is one history owner rather than two summaries racing by extension load order.

Near that boundary, Clawa can run one ordinary in-branch memory pass at 90% of the active model's
context window. Before a successful run settles, a hidden continuation asks the resident Clawa to
recall its five latest shared memories, update any whose truth has changed, and remember at most
five genuinely new pieces from the current run. Routine completion, temporary work, and truth
already owned by living documents should not be stored again. Zero new memories is a good result
when nothing deserves promotion.

The pass uses the current session, model, tools, and provider continuation. It is not a detached
sidecar and does not stage a competing compaction result. It fires once per compaction cycle and
rearms after Pi compacts or a new session starts. Cancelled or failed runs do not trigger it.
Pi alone decides when and how compaction happens, including during long runs before the pass can start.

## The practical hierarchy

1. **Session history** holds the detailed current branch.
2. **Pi's compaction boundary** keeps that branch usable when context grows.
3. **Raw memory** carries small facts and sparks across the crew.
4. **Living files and vault pages** hold shaped, durable understanding.

Do not copy everything upward. A transcript is not a memory, and a memory is not automatically an
identity rule.
