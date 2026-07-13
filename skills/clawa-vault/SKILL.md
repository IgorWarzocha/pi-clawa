---
name: clawa-vault
description: "Maintains a Clawa home's shared vault as a tidy, linked second brain. Use when saving durable knowledge, integrating research, finding what the home already knows, curating or reorganizing vault pages, repairing navigation, or promoting repeated memory into a reusable concept. Do not use for raw momentary memory, identity docs, task scratchpads, or documentation owned by a source-code project."
---

# Clawa Vault

## Purpose

Keep the main Clawa home's `vault/` useful as it grows. The vault is a small, flexible LLM-wiki shaped like the Open Knowledge Format: Markdown concepts, light YAML frontmatter, normal links, and curated indexes. It is a living second brain, not an archive of everything that happened.

All Clawas share one vault. Resolve its root from `PI_CLAW_PROJECT_ROOT` when set; otherwise use the bootstrapped main Clawa home containing `.pi/claw.jsonc`. Never create a worker-local vault.

## Memory boundary

- Use `remember` for quick raw capture that may matter later.
- Use `CLAW.md`, `HUMAN.md`, `CLAWAS.md`, `CURIOUS.md`, `TOOLS.md`, and nested `AGENTS.md` for selfhood, relationship, live curiosity, handles, and operating instincts.
- Use `vault/` when knowledge has been shaped enough to explain, connect, revisit, or improve.
- Leave project-owned documentation with its project. The vault may link to it or preserve cross-project understanding, but should not become a stale mirror.
- Keep credentials, tokens, private keys, precise private locations, and similarly dangerous-to-quote material out of the vault. Record a safe pointer or handling note instead.

## Concept shape

`index.md` and `AGENTS.md` are local navigation/instruction files, not concepts. Every Markdown concept starts with:

```markdown
---
type: concept-kind
title: Human-readable title
description: One sentence explaining what this page lets the house know or do.
---
```

Only a non-empty `type` is structurally required. Use a plain descriptive value and reuse an existing type before inventing a near-synonym. Keep `title` and `description` unless they genuinely add nothing. Add tags, timestamps, owners, resources, or other fields only when they earn their upkeep. Keep uncertainty and source links in the body where their meaning is clear.

Use relative Markdown links. A concept is one coherent subject, not necessarily one tiny fact. Prefer readable prose and useful structure over schema ceremony.

## Workflow

1. **Enter through the front door.**
   - Read `vault/index.md` and the most relevant linked sub-index first.
   - Search filenames, frontmatter, and bodies only when the map does not answer the question.
   - If search finds something the map hid, repair the map before leaving.

2. **Decide whether the vault is the right home.**
   - Decline raw dumps, transient tasks, session diaries, generated summaries with no future reader, and facts already owned clearly elsewhere.
   - Promote material that is reusable beyond the current turn, combines scattered understanding, records a durable decision, or gives future work a trustworthy starting point.

3. **Recall before writing.**
   - Search for an existing owner of the subject.
   - Update or merge before creating a sibling page.
   - Preserve disagreement or uncertainty instead of smoothing it into false certainty.
   - Re-read a shared target immediately before editing it. If another Clawa changed it, reconcile the newer shape instead of overwriting it.

4. **Write the smallest useful concept.**
   - Give it a stable, descriptive lowercase filename.
   - Explain what matters, why, and how it connects to existing knowledge.
   - Link related concepts instead of copying their contents.
   - Cite sources when provenance affects trust or future verification.

5. **Keep the route short.**
   - Add or update the nearest useful `index.md` and its one-sentence link description.
   - Keep every retained concept reachable from the root index through no more than one useful sub-index.
   - Curate descriptions and grouping rather than hiding pages; an index is a useful map, not a bare filename dump.

6. **Tidy while the shape is visible.**
   - When a folder becomes crowded or incoherent, regroup it around how the knowledge is actually sought.
   - When a category becomes sparse or artificial, flatten it.
   - Move or rename pages when the new route is clearer, then repair inbound links and indexes in the same pass.
   - Merge duplicates, remove empty folders, and delete stale pages whose useful truth now lives elsewhere.
   - Do not preserve obsolete layouts with backup copies. Use version control when available.

7. **Leave the vault traversable.**
   - Check frontmatter, links, names, duplicate ownership, and index reachability.
   - A future Clawa should be able to answer “where would this live?” from the front door without spelunking.
   - Stop when the knowledge has one clear home and the route to it is honest.

## Recovery

- **The subject fits several places:** choose the page that should own the truth, then link to it from the other routes.
- **The vault has no fitting shelf:** create the concept near the root first. Add a folder only after a real group exists.
- **The map and filesystem disagree:** trust the files, repair the map, and remove dead links.
- **The vault is broadly disorganized:** restore a useful root index first, then consolidate the highest-value duplicate or hidden areas. Do not attempt a grand taxonomy rewrite without evidence from the contents.

## Output

Finish with the paths created, updated, moved, or removed and one short note about how the knowledge is now found. Do not narrate routine searching or housekeeping.
