---
name: skill-creator
description: "Read before creating or revising a reusable agent skill."
---

1. Read the existing `SKILL.md` and every file it directly requires before restructuring or pruning. Keep verified decisions, commands, failure handling, and distinct examples, not upstream doctrine.
2. Identify the recurring decision the skill teaches. A tool runbook qualifies when its commands or recovery change execution. Passive reference belongs in documentation. A one-off prompt does not need a package.
3. Choose the scope before drafting. Portable skills must not assume one user's paths, tool catalog, repository, or provider. Project skills may carry local mechanics. Check available skill names for collisions and load applicable domain guidance when available, without making a personal catalog a dependency.
4. Write a quoted, imperative call trigger addressed to the reading agent: `Read before...`, `Use for...`, or `Must always apply.` Keep only the boundary needed to avoid a real neighboring task. Aim for at most 175 characters. Characters 176 through 200 need a reason; more than 200 is a quality error even though Pi permits 1024.
5. Start the body with the first action or decision, not a title, purpose, activation section, or input scaffold. Keep the normal path and central judgment here. Route conditional detail through exact local references. Use scripts for repeated deterministic work, not to decorate the package.
6. Write the delta to a competent agent's defaults. Each rule needs an observed failure, durable preference, or task-specific decision. If removing a sentence changes no future action, cut it. Do not replace deleted boilerplate with a mandatory template.
7. Preserve taste where it steers the result. Operational skills need observable checks and boundaries. Voice or creative skills may need one vivid example more than another rule. Keep the example that teaches a distinct decision or feel, not five polite happy paths.

Read `references/skills-reference-guide-for-agents.md` when changing host format, packaging, supporting files, or porting between hosts. For a narrow trigger edit, use its trigger section.

## Check the package

Run from this skill's directory, passing the target skill's path:

```bash
python3 scripts/skill-efficiency-check.py <skill-dir-or-SKILL.md>
```

Fix reported issues. Warnings need judgment, not automatic expansion. The checker covers single-line frontmatter, description length, body selection headings, and supporting paths in the entry. It cannot judge instruction value, imperative wording, or the whole reference tree.

Verify every routed file and exercise bundled scripts with valid and failing inputs. Use the target host's loader or diagnostics for host compatibility. When a trigger changes materially, compare obvious calls and the nearest non-call requests. Do not build an evaluation harness unless real selection failures warrant one.

## When the draft drifts

- Unreliable selection: compare actual call and non-call requests. Tighten the task boundary rather than adding a synonym inventory.
- An unwieldy body: delete repetition before moving conditional depth to references. Moving always-needed instructions saves nothing.
- Overlapping skills: compare their decisions and failure paths. Merge fake separations, not distinct jobs with shared vocabulary.
- A port loses its voice: restore the concrete example that carries it, not paragraphs of praise.

For example, "Be thorough" changes nothing. "If the export check fails, stop before publishing" changes execution. A human line such as "I wouldn't ship that. The safer move is X because Y" can steer a review better than "be warm and clear."
