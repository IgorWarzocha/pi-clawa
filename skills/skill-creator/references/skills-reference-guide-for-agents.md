Verify the target host's loader and skill documentation before changing format or discovery assumptions. Use the sections below for the branch you are working on, not as a template to reproduce in every skill.

## Pi format and loading

Pi exposes skill names, descriptions, and paths before loading their bodies. The description owns selection. Putting a second trigger section in the body cannot repair a missed load.

Prefer a directory containing `SKILL.md`. Resolve bundled paths against that directory, not the caller's working directory. Pi discovers these directories recursively in configured skill locations and stops descending once it finds a skill root.

Minimal frontmatter:

```yaml
---
name: contract-review
description: "Use for reviewing contract obligations and risks. Not for general PDF extraction."
---
```

- Names use lowercase letters, numbers, and hyphens, with no leading, trailing, or consecutive hyphens. Pi permits 1 through 64 characters.
- Match the name to the directory for portability. Pi permits a mismatch.
- Pi's description ceiling is 1024 characters. Our authoring quality limit is 200, with a preferred maximum of 175. These are separate constraints.
- Quote descriptions. YAML punctuation such as `: ` and ` #` can alter an unquoted scalar's meaning.
- Optional fields include `license`, `compatibility`, `metadata`, `allowed-tools`, and `disable-model-invocation`. Verify support before relying on them. A field's presence does not prove that the host enforces it.
- `disable-model-invocation: true` hides the skill from automatic selection in Pi. It remains explicitly invocable through `/skill:name`.
- Malformed frontmatter or a missing or blank description prevents loading. Other invalid fields can produce diagnostics without rejecting the skill. Pi keeps the first discovered skill when names collide, with a warning. Do not assume a project skill overrides a same-named user skill.

Pi supports user and project skill directories, Agent Skills locations such as `~/.agents/skills/` and `.agents/skills/`, configured paths, and package resources. Use the installed host's docs to choose the owning location. Do not hard-code another user's home or depend on a private catalog.

In an interactive Pi session, `/reload` refreshes edited skills and `/skill:name <request>` forces a load. These are Pi commands, not shell commands. Inspect loader diagnostics when a skill fails to appear. For another host, verify its equivalent rather than copying Pi behavior.

## Trigger edits

Address the reader at selection time. Describe when to read or apply the skill, not what the package offers.

Weak:

```yaml
description: "Reviews PDF contracts and extracts obligations, risks, renewal terms, and missing clauses."
```

Better:

```yaml
description: "Read before reviewing a contract's obligations, renewal terms, or risks."
```

Keep the nearest real collision only. A contract review skill may exclude general PDF extraction if that confusion occurs. It does not need a list of every task it cannot do.

For a materially changed trigger, compare a few real or representative requests. "Review this lease's renewal clause" should call the contract skill. "Extract the scanned PDF's text" should not. If selection fails, inspect frontmatter, discovery, and name collisions before expanding the description. Add request variants only when they disambiguate the task.

Descriptions of 176 through 200 characters are warnings that need a concrete reason to keep the extra boundary. More than 200 is a quality error, even if the host accepts it. Do not use the host ceiling as a writing budget.

## Supporting material

Keep the actions and decisions needed on every run in `SKILL.md`. A reference belongs behind a condition: a host-specific branch, schema, recovery path, or extended example. Put the route beside the decision that needs it.

Use:
- `references/` for conditional knowledge.
- `scripts/` for repeated deterministic checks or transformations.
- `assets/` for static inputs consumed by the workflow.

Do not create empty directories or compulsory templates. When an asset is necessary, say when and how it is consumed. When a capability skill would help, ask the reader to discover an applicable skill if available, not to load a hard-coded package from the author's environment. Keep essential execution possible without that catalog.

References also start inside execution, not with a repeated purpose or filename heading. Preserve useful examples beside the decision they teach. A before-and-after phrase can carry more judgment than an adjective stack:

> Instead of "Done, improved everything," show "Changed X, left Y alone, and the check passes."

Do not move always-required procedure to a reference merely to shrink the entry. Delete generic rules and repeated examples before relocating useful knowledge.

## Script and path checks

Use explicit arguments, stable exit codes, useful diagnostics, and declared dependencies. Avoid interactive prompts or hidden writes in validators. State failure behavior where the script controls a consequential action.

This package's checker uses only Python's standard library:

```bash
python3 scripts/skill-efficiency-check.py <skill-dir-or-SKILL.md>
```

Run it from the authoring skill's directory, not the target directory. Exit 0 means no reported issues. Exit 1 means structural or quality issues remain. Warnings do not change the exit status. Argument errors use argparse's exit 2.

The checker deliberately supports single-line `name` and `description` strings, not all YAML. It decodes quoted escapes and rejects ambiguous plain scalars, duplicate top-level fields, malformed delimiters, and missing required values. Optional metadata is not validated. Use the host loader for full YAML and discovery compatibility.

It checks entry-body references written as backtick paths or Markdown links under `references/`, `scripts/`, and `assets/`. Missing files, directories used as files, and resolved paths escaping the skill root are errors. It does not recursively validate references or prove that a script works.

Walk every route yourself. Exercise helpers with a valid input and a meaningful failure input. A failed tool connection should stop dependent actions. An invalid export should stop publication. Do not invent elaborate recovery for a skill with no such side effects.

If a workflow creates persistent or external artifacts, define what another run does with an existing item: update by stable identifier, skip it, or create a deliberate version. Do not add duplicate-handling ceremony to a conversational skill with no persistent effect.

## Porting and pruning

Read both complete entries and their required files before reconciling variants. Map the behavioral differences rather than chasing textual parity.

Keep verified commands, schemas, failure modes, local judgment, and distinct voice examples. Replace stale host assumptions. Drop vendor doctrine, repeated trigger prose, generic quality wishes, and provider-specific folklore without evidence.

Keep repository mechanics in a project-scoped skill or local guidance. Distill portable skills into decisions and failure boundaries instead of carrying paths and versions from the source project. If local guidance is a small addendum, give it a distinct name and tell its reader to discover applicable general guidance when available.

Inspect the diff for lost decisions, verify supporting paths, exercise scripts, and check the target host. Use a source validator only when available and relevant. Report intentional format differences instead of hiding them.

Stop after the package is usable and relevant checks pass. A real selection or execution failure can justify a later evaluation. The existence of a skill does not justify a new test framework.
