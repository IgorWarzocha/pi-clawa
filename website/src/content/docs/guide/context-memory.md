---
title: Context, memory, and continuity
description: See where current context, raw memory, recall, and compaction each belong.
section: Core concepts
order: 40
---

Clawa has four continuity mechanisms. They overlap just enough to hand work from one timescale to
another, but they are not interchangeable.

## Hydration: the current shape

Before each provider call after bootstrap, Clawa prepends one fresh hydration block built from five
living files. Old hydration copies are removed first, so tool loops and compaction do not accumulate
duplicate identity context.

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

`recall` searches both shared SQLite memory and the current Clawa's discovered Pi session files. It
returns memory IDs for edits and file/line anchors for session matches. Session search skips tool
calls and tool results, which reduces noise and avoids treating command output as remembered human
intent.

Recall is explicit, not ambient. The model should search when prior preference or a decision may
matter, not on every turn. During first-run onboarding it is specifically discouraged unless you ask
or the session is resuming after compaction.

## Compaction: carry the branch

Pi's configured default, custom, or provider-native compactor carries the canonical session branch.
Clawa does not replace or merge that result. Pi cannot compose competing compaction summaries, so
there is one history owner rather than two summaries racing by extension load order.

Alongside compaction, Clawa sends a lean serialization of the prepared segment to the configured
sidecar model—or the active model by default—and asks for at most three short durable memory lines.
This sidecar request is cache-cold and independent from the main provider continuation. Its output
budget and transport are left to the selected provider. It stages its result without touching
SQLite. Only after Pi reports successful compaction are the staged memories written to the shared
database; failed, aborted, replaced, and stale operations are discarded.

Automatic compaction runs after the agent has settled when usage reaches the configured percentage
of the active model context window—80% by default. Pulses and private comms wait behind the pending
compaction operation so they do not inject into a branch while its context is changing. After a
successful compaction, a still-high usage reading cannot immediately launch another one. The policy
rearms after usage falls below the threshold or a new session begins.

## The practical hierarchy

1. **Session history** holds the detailed current branch.
2. **Pi's compaction boundary** keeps that branch usable when context grows.
3. **Raw memory** carries small facts and sparks across the crew.
4. **Living files and vault pages** hold shaped, durable understanding.

Do not copy everything upward. A transcript is not a memory, and a memory is not automatically an
identity rule.
