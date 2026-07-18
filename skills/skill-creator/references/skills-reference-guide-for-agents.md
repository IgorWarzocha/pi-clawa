# Skills Reference Guide for Agents

Use this guide to design, write, test, and package skills built around `SKILL.md` with optional `references/`, `scripts/`, and `assets/`.

This is deeper than the main skill but still a reading map, not a mandatory template. Host rules outrank it. Verify format limits, discovery behavior, supported frontmatter, and tool names instead of assuming every agent surface is identical.

## Reading map

- **Creating or substantially restructuring a skill:** read sections 1–8 and 12.
- **Fixing triggering:** read sections 3–4 and 10.1.
- **Splitting supporting material:** read sections 2 and 6–7.
- **Debugging execution:** read sections 5, 8, and 10.
- **Porting or reconciling variants:** read sections 3–5, 9, and 11–12.
- **Packaging or final review:** read sections 9–12.

## 1. Skill fit

A skill is a portable instruction bundle for a repeatable task or workflow. It should answer:

1. What problem does it solve?
2. When should the host load it?
3. What steps should the agent follow?
4. What tools, files, or references may it use?
5. What does success look like?
6. What happens when a critical step fails?

Use a skill when the task recurs and reusable instructions, judgment, validation, or examples improve execution.

Use another artifact when that fits better:

- ordinary documentation for passive reference material
- a prompt for a one-off framing change
- a workspace workflow or SOP for a rigid project procedure
- nothing yet when the workflow is still too vague to name concrete requests and results

A tool runbook can still be a skill when commands, failure handling, or result interpretation materially change agent behavior.

### Behavior test

A useful skill changes at least one of:

- activation or trigger selection
- step order
- tool or file choice
- validation or stop conditions
- error recovery
- judgment at a decision point
- output contract or voice

If it only says “do a good job,” delete or rewrite it.

Warmth can pass this test. A concrete voice sample, review shape, refusal shape, or before/after rewrite changes behavior. A paragraph saying “be warm and helpful” usually does not.

## 2. Progressive disclosure and folder shape

A skill reveals information in layers:

- frontmatter tells the host what the skill does and when to load it
- `SKILL.md` carries normal execution and central judgment
- linked files carry conditional depth, deterministic helpers, or static inputs

Typical shape:

```text
skill-name/
├── SKILL.md
├── references/   # optional guidance, edge cases, extended examples
├── scripts/      # optional deterministic checks or transforms
└── assets/       # optional templates and static inputs
```

Default to only `SKILL.md`, but do not confuse minimalism with refusing useful support files. Add a folder when it makes the skill more complete or dependable.

Keep anything the agent must always know in `SKILL.md`. Moving required procedure into a reference saves no real context because every run still has to load it.

## 3. Frontmatter

Minimal form:

```yaml
---
name: skill-name
description: "Does X. Use when the user asks for A, B, or C. Not for Y."
---
```

### Name

- Use lowercase kebab-case.
- Keep it concise and workflow-oriented.
- Match the folder when the host requires it. Pi permits a mismatch for shared-directory compatibility.
- Pi allows 1–64 characters.

### Description

The description owns selection. It should state:

- what the skill does
- when to use it
- likely request language, artifacts, or outcomes
- negative scope only where a nearby task could trigger it incorrectly

Quote it by default. Plain YAML scalars can break on `: `, ` #`, braces, and brackets.

Pi permits descriptions up to 1024 characters. Treat that as a compatibility ceiling, not a target. Reliable trigger coverage matters more than arbitrary shortness, but descriptions near the ceiling deserve another editing pass.

Keep body sections called `When to use`, `Activation`, or `Triggers` out of `SKILL.md`. The host selects the skill before reading those sections. Operational scope and safety boundaries still belong in the body when they affect execution.

Pi may also support `license`, `compatibility`, `metadata`, `allowed-tools`, and `disable-model-invocation`. Verify the target host before adding optional fields.

## 4. Trigger design

Describe the job from user intent, not internal architecture.

Good:

```yaml
description: "Reviews PDF contracts and extracts obligations, risks, renewal terms, and missing clauses. Use when the user uploads contract PDFs or asks for contract review or clause extraction. Not for general PDF summarisation."
```

Weak:

```yaml
description: "Implements hierarchical document entities with storage abstractions."
```

The weak version describes internals, not what a user asks for.

If the skill under-triggers, add concrete request variants and artifact names. If it over-triggers, narrow category words to the actual outcome and add only the plausible adjacent exclusions.

Before finalizing a materially changed description, review:

- two obvious trigger requests
- one paraphrased trigger request
- two nearby requests that should not trigger

Do not build a large evaluation harness until repeated real failures justify one.

## 5. Operational body

Always include a purpose, ordered workflow, and critical constraints. Add other sections only when they remove ambiguity or change execution:

- inputs and prerequisites
- exact commands, paths, tools, or schemas
- autonomy and approval boundaries
- validation and stop conditions
- error recovery
- output contract
- examples

Put critical rules near the action they govern. State important safety or approval boundaries once rather than scattering reminders through the file.

### Observable instructions

Bad:

> Validate carefully and handle errors gracefully.

Better:

> Run `python scripts/validate.py <file>`. If it exits non-zero, show the first failing rule and stop before writing generated exports.

### No-op test

For each sentence ask: “If this line disappears, what specific future action changes?”

- no answer: delete it
- vague answer: rewrite it as a condition, command, path, threshold, output, or forbidden action
- concrete answer: keep it

Common no-ops:

- “be thorough”
- “write clearly”
- “use best practices”
- “produce high-quality output”
- “consider edge cases” without naming them
- repeated “validate” bullets without a check

### Warm skills

Some skills intentionally shape a companion, writer, reviewer, designer, or house voice. Do not sand those flat.

Prefer:

- one before/after phrase
- one sample final response
- exact words or patterns to avoid
- a small interaction boundary such as “ask one pointed question, then act”

Avoid:

- abstract adjective stacks
- generic “friendly, clear, concise” lines
- long philosophy without a sample action or output

Example:

```md
Instead of: “Be warm and concise.”
Use: “If rejecting a request, keep it human and direct: ‘I wouldn’t ship that. The safer move is X because Y.’”
```

The second version gives the next agent something it can actually imitate.

### Example budget

Use examples when they teach a decision, boundary, common failure, output shape, or desired feel that prose leaves ambiguous.

Good:

```md
User says: “This skill keeps triggering for generic frontend work.”
Do: tighten `description` with a nearby exclusion: “Not for general UI polish without a DESIGN.md artifact.”
```

```md
Bad final: “Done, improved everything.”
Good final: “Changed `SKILL.md`, removed the duplicate trigger section, kept the tone example, and both validators pass.”
```

Bad example use:

- ten variants of the same happy path
- conversations that only demonstrate politeness
- large transcripts where three lines teach the same lesson
- examples naming tools or files the skill never uses

## 6. Scripts

Use scripts when code makes a repeated check or transform more reliable than prose:

- parsing and schema validation
- deterministic transformation
- output normalization
- repeatable lint or packaging checks

Do not add a script to make the folder look sophisticated. A helper that replaces no repeated deterministic pain is a pet.

Scripts should:

- accept explicit arguments
- avoid interactive prompts
- return stable exit codes
- write predictable stdout and useful diagnostics
- document non-standard dependencies
- behave deterministically for the same input
- avoid hidden destructive side effects

When a script's result controls the workflow, document its contract:

```md
Run `python scripts/validate.py --input <file>`.

- exit 0: validation passed
- exit 1: input is invalid; stop before generation
- exit 2: execution failed; report the diagnostic
```

Exercise bundled scripts during validation rather than merely checking that their paths exist.

## 7. References and assets

Use `references/` for conditional detail:

- host or API conventions
- schemas and field definitions
- domain rules and edge cases
- detailed examples and error catalogues

References should be factual, chunkable, and linked by exact path. Prefer one topic per file and put examples beside the rule they clarify.

Use `assets/` for static material consumed by the workflow:

- report or document templates
- JSON schemas
- boilerplate fragments
- sample inputs
- style guides

If a template or asset is required, say when and how to use it in `SKILL.md`.

Keep the skill self-contained. Do not require another skill to understand this one; inline the essential rule or make a local reference.

## 8. Workflow and failure design

### Ordered stages

For multi-step work, make handoffs explicit:

1. inspect or collect inputs
2. validate only what matters before consequential work
3. transform, decide, or generate
4. verify the actual result
5. save, publish, or report

### Proportionate failure behavior

Block only when uncertainty affects correctness, safety, external side effects, or the ability to complete the requested result.

- Missing required input: ask or stop.
- Invalid output before a consequential side effect: report and do not proceed.
- Tool connection failure: report the concrete failure before dependent actions.
- Cheap safe operation that reveals availability itself: try it instead of building a diagnostic ceremony.

### Stop conditions

State when to stop if the workflow could otherwise loop:

- stop when the required result exists and relevant validation passes
- cap iterations when another pass cannot add evidence
- stop before dependent side effects when authentication or connection fails

### Repeated runs

When a skill creates external or persistent artifacts, define duplicate behavior:

- update by stable identifier
- skip an existing item
- create a deliberate versioned copy
- ask when replacement would be destructive

Do not add idempotence ceremony to a simple conversational skill with no persistent effect.

## 9. Validation and packaging

Run the bundled check:

```bash
python scripts/skill-efficiency-check.py <skill-dir-or-SKILL.md>
```

Treat:

- failures as structural problems to fix
- warnings as review prompts
- suggestions as optional design questions, not orders to create folders

Also:

- verify every required supporting path
- exercise bundled scripts
- use the host's own validator when available
- run repository checks when the skill ships in a package
- inspect the final diff so intentional local judgment was not overwritten

Keep the folder clean. Do not add empty supporting directories, duplicate human-facing manuals, or temporary evaluation debris.

## 10. Testing and troubleshooting

Choose tests according to risk, complexity, and observed failure modes. Trigger, functional, output, and efficiency tests are a menu, not a mandatory harness for every edit.

### 10.1 Skill does not load or loads too often

- Check whether the description names the concrete job and likely request language.
- Validate frontmatter and discovery location.
- Check for name collisions.
- Compare the description with neighboring skills.
- Add exclusions only for plausible collisions.

### 10.2 Skill loads but instructions are ignored

- Move critical rules near the action they govern.
- Make ordering explicit.
- Replace vague verbs with observable conditions.
- Add one representative decision or output example only if ambiguity remains.

### 10.3 Tool calls fail

- Verify exact tool names, permissions, inputs, and return shapes.
- Record critical prerequisites.
- Avoid preflight loops when trying the safe operation reveals availability directly.

### 10.4 Output varies too much

- Clarify the success condition and decision rules.
- Add targeted validation, one representative example, or a deterministic helper according to the actual source of variation.

### 10.5 Context grows without value

- Remove repeated guidance and examples first.
- Move conditional depth out of `SKILL.md`.
- Preserve material that still changes judgment, including useful warmth.

## 11. Porting and reconciliation

When adapting an upstream or canonical skill:

1. Read both complete versions and all required supporting files.
2. Map behavioral differences before editing.
3. Preserve local verified judgment, voice examples, paths, and host constraints.
4. Bring across newer structural rules, limits, recovery, and validation when they improve the target.
5. Do not preserve vendor doctrine, stale assumptions, or repetition merely because it is canonical.
6. Do not flatten the target by copying upstream wholesale.
7. Run both validators when source and target provide them.
8. Report intentional differences rather than hiding them.

The aim is not textual parity. It is behavioral parity where the upstream is stronger, with local taste intact.

## 12. Final review

### Structure

- `SKILL.md` exists at the root.
- Frontmatter parses under the target host.
- Name and description fit host limits.
- Supporting files are useful and local.

### Trigger quality

- Description states what the skill does and when it applies.
- Concrete request language, artifacts, or outcomes are present.
- Scope is neither a vague category nor a brittle exact phrase list.
- Exclusions cover real neighboring collisions only.

### Instruction quality

- Workflow is ordered.
- Important judgment and failure handling survived pruning.
- Validation is proportionate to consequences.
- Success is clear where the workflow needs a defined result.
- Examples teach distinct decisions, output shape, or needed warmth.

### Operational quality

- Tool names, commands, paths, and runtime assumptions were verified.
- Scripts have clear contracts and were exercised.
- Repeated runs avoid uncontrolled duplicates where side effects are possible.
- Generic reassurance and repeated examples were trimmed before useful knowledge.

### Finish

- Inspect the diff for accidental loss of local design material.
- Run the bundled validator and any host or canonical validator requested.
- Report changed files, validation, and intentional tradeoffs concisely.

Optimize first for reliable activation and execution. Then remove accumulated text that no longer changes behavior. Keep the line or example that makes the next agent feel the work correctly.
