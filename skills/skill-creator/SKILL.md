---
name: skill-creator
description: "Designs, writes, refactors, and packages agent skills. Use for new skills, SKILL.md improvements, trigger descriptions, references/scripts splits, examples, validation, or porting workflows. Not for one-off prompt tweaks, strict runbooks, or vague workflows."
---

# Skill Creator

Create or reshape reusable agent skills without turning them into markdownware.

## Hard rules

- A skill must change future agent behaviour: trigger choice, file/tool use, step order, validation, failure handling, or output shape.
- Delete no-ops: lines like “be thorough”, “write clearly”, “make it good”, “be useful”, “use best practices”, or generic quality wishes unless they name an observable action.
- Put trigger rules in frontmatter `description`, not in body sections called “When to use”, “Triggers”, or similar.
- Add `references/` only for conditional detail. Inline anything the agent must always read.
- Add `scripts/` only for deterministic checks or transforms that prose would make brittle.
- Do not cross-reference other skills. Inline the needed rule, make a local reference, or merge the skills.
- Do not create a skill for glossary, atlas, curriculum, one-off prompt, or vague category work.

## Required input

- The workflow/problem.
- Target skill path, or enough context to infer it.

Ask one pointed question only if the workflow, target path, or destructive edit boundary is unclear.

## Workflow

1. **Prove the skill should exist.**
   - Recurring workflow? recognizable steps? reusable quality gain?
   - If not, make docs or do the one-off task instead.

2. **Map the trigger boundary.**
   - Write the frontmatter description from user phrasing.
   - Include negative scope if over-triggering is likely.
   - Keep product/domain repetition out of repo-local skill names/descriptions when the repo already supplies context.

3. **Choose the smallest file shape.**
   - Start with one `SKILL.md`.
   - Split only detail that is optional during normal runs.
   - Prefer exact local paths over vague “check the docs”.

4. **Write operational instructions.**
   Include only material that changes execution:
   - required inputs
   - exact files/commands/tools
   - ordered steps
   - stop/ask boundaries
   - validation that catches real failure
   - error recovery
   - output contract
   - short examples only when they prevent predictable mistakes

5. **Run a no-op pass.**
   For each sentence ask: “If this line is removed, what specific future action changes?”
   - No answer: delete it.
   - Vague answer: rewrite as a concrete branch, command, path, check, or output rule.

6. **Ground before deleting or merging.**
   When auditing existing skills, read `SKILL.md` and referenced local files first. Verify tool/path claims before preserving them.

7. **Validate.**
   Run from this skill directory or with an absolute script path:

   ```bash
   python scripts/skill-efficiency-check.py <skill-dir-or-SKILL.md>
   ```

   Fix hard issues: invalid frontmatter, missing `name`/`description`, non-kebab name, forbidden trigger sections, overlong description failure.

8. **Ship cleanly.**
   Leave the edited skill files, then report:
   - changed path(s)
   - trigger sentence if changed
   - references/scripts added or removed
   - efficiency check result

## Error handling

- **Workflow too vague:** reduce to 2–3 concrete use cases before writing.
- **Overlapping skills:** merge if normally used together; turn subsection-skills into sections.
- **Reference always required:** inline it.
- **Script becoming a pet:** delete it unless it replaces repeated deterministic pain.
- **Copied upstream skill is preachy:** keep the workflow; delete doctrine.
