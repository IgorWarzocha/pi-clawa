# Skills reference guide

Use this as a compact standard while authoring or auditing skills.

## Skill test

A skill is valid when it changes at least one of:

- activation/triggering
- step order
- tool or file choice
- validation or stop conditions
- error recovery
- output contract

If it only says “do a good job”, delete or rewrite it.

## Folder shape

```text
skill-name/
  SKILL.md
  references/   # optional, conditional detail
  scripts/      # optional, deterministic helpers
  assets/       # optional, static inputs/templates
```

Default to only `SKILL.md`.

## Frontmatter

```yaml
---
name: skill-name
description: "Does X. Use when the user asks for A, B, or C. Not for Y."
---
```

Rules:

- `name` uses kebab-case and matches the folder.
- `description` owns trigger selection.
- Quote `description`.
- Do not duplicate trigger sections in the body.

## Body contents

Keep sections that change execution:

- purpose in one or two lines
- required inputs
- hard boundaries
- ordered workflow
- exact commands/paths/tools
- validation/failure handling
- output contract
- examples only for common mistakes

## No-op patterns to remove

Delete or rewrite lines like:

- “be thorough”
- “write clearly”
- “make it easy to read”
- “follow best practices”
- “produce high-quality output”
- “be concise” without a concrete output limit
- “consider edge cases” without naming which edge cases
- repeated “validate” bullets that do not define a check

Rewrite examples:

- Bad: “Validate carefully.”
- Good: “Run `python scripts/validate.py <file>` and stop on non-zero exit.”

- Bad: “Keep docs useful.”
- Good: “If the new rule changes future runs, add one bullet to `AGENTS.md`; otherwise leave no doc.”

## References

Use `references/` for conditional detail only:

- schemas
- API quirks
- long examples
- error catalogues
- templates too large for the main body

If the agent always needs it, inline it.

## Scripts

Use `scripts/` only when code makes the result more reliable:

- parsing
- validation
- migration/transforms
- repeatable lint/check logic

Do not add scripts for rare edits an agent can do by reading files.

## Audit checklist

- Does every paragraph change behaviour?
- Is trigger selection only in frontmatter?
- Are references local and conditional?
- Are scripts boring and likely to be reused?
- Are examples short and mistake-driven?
- Can a future agent run the workflow without guessing paths or commands?
