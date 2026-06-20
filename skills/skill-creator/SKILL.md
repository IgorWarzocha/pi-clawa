---
name: skill-creator
description: "Designs, writes, refactors, and packages agent skills. Use for new skills, SKILL.md improvements, trigger descriptions, references/scripts splits, examples, validation, or porting workflows. Not for one-off prompt tweaks, strict runbooks, or vague workflows."
---

# Skill Creator

## Purpose

Use this skill to build or improve reusable skills for the current workspace without turning them into bloated promptware. A good skill is a small, sturdy tool: it triggers when the user needs it, stays quiet when they do not, keeps its frontmatter lean, and teaches the agent an actual workflow instead of a vibe.

Keep the house style in the bones: act when the path is clear, keep warmth where it helps, and troubleshoot only when reality actually breaks.

## Inputs expected

### Required

- The workflow or problem the skill should handle.
- The target skill path or enough context to infer it.

### Optional

- Existing `SKILL.md` to improve.
- Reference docs, example prompts, or upstream skills to adapt.
- Whether the skill should stay minimal or include `references/` / `scripts/`.

## Prerequisites

- Read `references/skills-reference-guide-for-agents.md` before authoring or heavily restructuring a skill.
- Prefer exact paths and existing workspace conventions over invented structure.

## Workflow

1. **Confirm the task deserves a skill.**
   - A skill is warranted when the workflow recurs, has recognizable steps, and output quality improves when structure is reused.
   - Do not create a skill just because a topic or category exists. If it is mostly glossary, training, atlas, or lookup material, make it docs instead.
   - If the workflow is still mushy, tighten the use cases before writing anything.

2. **Map the real trigger boundary.**
   - Define what the skill does, when it should load, and when it should stay quiet.
   - Write the description from user intent, not internal architecture.
   - Add negative scope when over-triggering is likely.
   - For repo-local skills, do not waste tokens repeating the repo/app/domain name in every skill name, example, and description when that context is already implied by the repo. Global skills still need explicit domain names.

3. **Design the smallest shape that will work.**
   - Default to one `SKILL.md`.
   - Add `references/` only when detailed material would bloat the main file and is genuinely conditional.
   - Inline short references, and inline any reference that the agent must always read to operate the skill.
   - Add `scripts/` only when deterministic validation or transformation is genuinely better in code.
   - Do not add folders just to look serious.
   - Do not cross-reference other skills or their references from inside a skill; each skill should be operationally self-contained.
   - If two skills are normally used together, merge them. If one skill is just a subsection of another, make it a section or local reference.

4. **Draft the frontmatter last, but keep it lean.**
   - Default to only `name` and `description` unless extra fields are truly justified.
   - Keep the description trigger-rich and compact.
   - Quote `description` by default; unquoted YAML breaks on `: `, brackets, braces, and other plain-scalar traps.
   - Put all trigger guidance in the frontmatter `description`: what the skill does, when to use it, and when not to use it if overlap is likely.
   - Do not add `When to use`, `Do not use when`, `Activation`, `Triggers`, or similar trigger-boundary sections to the skill body. By the time the body is loaded, the agent should already know why this skill applies; if not, the `description` is wrong and must be improved.
   - Avoid architecture-centred or product-marketing wording.

5. **Write the operational body.**
   - Include the core job, boundaries, expected inputs, workflow, validation, error handling, output contract, and a few realistic examples.
   - Keep body boundaries operational: prerequisites, safety limits, handoff rules, and workflow constraints are fine; trigger-selection guidance belongs in frontmatter only.
   - Keep the step order explicit.
   - Put critical rules near the top.
   - Prefer exact file paths when pointing to supporting material.
   - Validation/quality steps that only happen after doing the work belong inside that work skill, not in a separate quality skill.
   - Tool runbooks can be skills when exact commands, failure modes, and output interpretation change agent behaviour; if the runbook is always needed, keep it in `SKILL.md` rather than a separate reference.

6. **Ground the content before pruning or preserving.**
   - Before deleting or merging a skill, read its `SKILL.md` and every referenced file.
   - Verify important claims against the real files, docs, commands, or tooling the skill talks about.
   - Keep the useful verified bits, discard vague doctrine, and move non-operational knowledge to docs.
   - Do not send discovery into unrelated global/project skill directories; scope the audit to the user-requested skill set.

7. **Bake in house style deliberately.**
   - Assume availability first; do the normal thing before opening a troubleshooting box.
   - Keep troubleshooting detail conditional unless it is required for every normal run.
   - If the path is clear and low-risk, act first instead of interrogating the user to death.
   - Ask before destructive or high-blast-radius changes.
   - Warm the prose when the skill is collaboration-facing or identity-adjacent, but keep procedural docs crisp.

8. **When trigger quality feels off, correct it by feel first.**
   - If the human says a skill does not trigger well enough, assume the description is too vague, too timid, or missing their actual phrasing.
   - Tighten or broaden the `description` using the way they naturally ask for the thing.
   - Add negative scope if the skill is barging in where it should stay quiet.
   - Do not default to elaborate eval harnesses or benchmark theater unless the user explicitly wants that.
   - Make the trigger sentence sharper, then let real use tell us if it still misses.

9. **Validate the skill against the guide and the house.**
   - Trigger boundary is clear.
   - Frontmatter is slim.
   - Frontmatter YAML parses cleanly; quote `description`, especially when it contains `: `.
   - Workflow is ordered.
   - References are exact, local to the skill, and only loaded when needed.
   - Short or always-needed references have been inlined.
   - Nearby skills are not fake separations of the same workflow.
   - It does not turn every task into diagnostics-first ritual.
   - It does not become a little church when a bounded tool would do.

10. **Run the required efficiency pass after every create/update.**
   - Run `python scripts/skill-efficiency-check.py <skill-dir-or-SKILL.md>` from this skill directory for every skill touched.
   - Read the report as a prompt-budget and house-style check, not as an automatic rewrite engine.
   - Do not edit the checker just to make a skill pass; interpret it.
   - Fix structural hard issues before shipping: invalid frontmatter, missing `name` / `description`, non-kebab name, forbidden trigger-selection body sections, or descriptions above the failure threshold.
   - Treat body length as guidance, not a hard rule. Sometimes longer is better, especially when inlining always-needed references makes the skill more usable and prevents reference-chasing.
   - Treat warnings as judgement calls: long but necessary descriptions may stay, but first try to preserve trigger nouns while cutting filler.
   
11. **Ship the skill cleanly.**
   - Create or update the files directly when the target path and intent are obvious.
   - Include the efficiency pass result in the final summary when a skill was created or changed.
   - Summarize what was created or changed and why.
   - If useful, call out the trigger sentence so it is easy to sanity-check.

## Validation

Before shipping, check:

- It is a recurring workflow that changes agent behaviour, not just a subject category.
- Glossaries, curricula, atlases, and passive lookup material are docs, not skills.
- The description is trigger-rich, compact, and not over-broad.
- Frontmatter is lean and valid.
- The body has ordered workflow, validation/error handling where useful, and no trigger-selection sections.
- Short or always-needed references are inlined; remaining references are local, exact, and conditional.
- The skill does not cross-reference other skills or their reference files.
- Nearby skills are not fake separations of the same workflow.
- The workflow does the normal thing first and troubleshoots only when something actually hurts.
- Examples are concrete enough to teach the shape.
- The efficiency pass has run; structural hard issues are fixed, while body-length warnings are judged against usefulness and reference-chasing.

## Error handling

### Error: workflow is too vague

Action: reduce it to 2-3 concrete use cases before drafting the skill.

### Error: over-triggering or under-triggering risk

Action: tighten or broaden the description with explicit examples and exclusions.

### Error: main file is getting bloated

Action: move bulky optional detail or edge cases into local `references/`. Keep always-required material in `SKILL.md`.

### Error: too many small overlapping skills

Action: merge skills that are normally used together; turn subsection-skills into sections or local references; move non-operational material to docs.

### Error: skill references another skill

Action: inline the needed rule, move it into a local reference, or merge the skills. Do not bounce the agent between skills.

### Error: deterministic check is too fuzzy in prose

Action: move that check into `scripts/` only if the repeatable logic really benefits from code.

### Error: copied external skill is preachy or tool-religious

Action: keep the useful workflow, delete the church.

## Output contract

A completed skill-creation pass should leave:

- a valid `SKILL.md` in the right folder
- any needed `references/` or `scripts/` files
- a clear trigger description
- explicit boundaries and workflow
- a passing efficiency check, or a clearly explained warning/length tradeoff that was intentionally left
- a concise summary of what changed and why

## Examples

### Example 1

User says: "Make me a skill for turning recurring repo spelunking into a reusable workflow."

Expected behaviour:

1. Confirm the workflow is recurring.
2. Read the skills guide.
3. Draft a minimal skill with a sharp trigger boundary.
4. Add references only if the main file starts getting fat.

### Example 2

User says: "This skill is too robotic and keeps running diagnostics first. Fix it."

Expected behaviour:

1. Read the existing skill.
2. Identify the diagnostics-first smell.
3. Split troubleshooting into a separate reference if needed.
4. Rework the default workflow so it tries the normal path first.

### Example 3

User says: "Port this upstream skill, but make it fit our house."

Expected behaviour:

1. Extract the real workflow from the upstream material.
2. Keep the useful patterns.
3. Remove doctrinal, bloated, or tool-religious framing.
4. Rebuild it with our trigger style, boundaries, and house posture.
5. Run the efficiency pass and fix any hard issues before reporting back.

### Example 4

User says: "This skill pile is messy; consolidate it."

Expected behaviour:

1. Scope the audit to the skill directories the user actually asked about.
2. Read every `SKILL.md` and every referenced file before deleting anything.
3. Verify questionable claims against real repo files, docs, commands, or tools.
4. Merge fake separations, inline short/always-needed references, and move passive reference material to docs.
5. Run efficiency and link checks, then summarize what was merged, moved, deleted, and why.
