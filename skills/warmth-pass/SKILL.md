---
name: warmth-pass
description: "Warms stiff internal agent docs without losing rules, paths, commands, tool names, boundaries, or facts. Use for AGENTS.md, SOUL.md, USER.md, MEMORY.md, IDENTITY.md, persona cards, worker-home docs, or project instructions that feel robotic. Do not use for schemas, runbooks, API specs, or grammar-only cleanup."
---

# Warmth Pass

## Purpose

A warmth pass makes internal agent documents feel inhabited without breaking the machine underneath. The job is not to make prose cute, quirky, or decorative. The job is to keep the operational contract intact while removing generic assistant voice, compliance bark, and dead report language.

This is for identity-bearing docs: the files that teach an agent who it is, whose house it is in, what it protects, how it works, and what kind of voice should survive a long session.

## Inputs expected

Required:
- the target file or text
- enough surrounding context to understand the agent, project, or home

Optional:
- voice words to aim for, such as dry, warm, blunt, careful, playful, calm
- phrases that must stay
- known phrases to avoid
- related files such as `AGENTS.md`, `SOUL.md`, `USER.md`, `MEMORY.md`, `IDENTITY.md`, `TOOLS.md`, or worker-home docs

## Core rules

1. **Never drop plumbing.** Exact paths, commands, tool names, config keys, safety rules, permissions, runtime facts, and workflow boundaries survive the rewrite.
2. **Do not rename instruments.** If the tool is called `bash`, keep `bash`. If the file is `.pi/APPEND_SYSTEM.md`, keep that exact path.
3. **Warmth is posture, not decoration.** Avoid mascot metaphors, cute chaos language, teaser phrasing, and catchphrases.
4. **Use house language carefully.** The filesystem can be a house, a project can be home, and cleanup can mean keeping the house easy to move through. Do not turn this into animal lore or theatrical worldbuilding.
5. **Specific beats polished.** Prefer concrete behaviour, real constraints, and crisp examples over abstract claims.
6. **Stop before it becomes perfume.** If the rewrite starts sounding purple, clever, or self-impressed, cut it back.

## Document species

### Identity and behaviour docs

Examples:
- `AGENTS.md`
- `SOUL.md`
- `USER.md`
- `MEMORY.md`
- `IDENTITY.md`
- persona cards
- worker-home instructions

For these, compliance language usually weakens the document. Convert rule-bark into stable instinct where safe.

Bad:
> The agent MUST protect secrets and SHOULD avoid unnecessary user queries.

Better:
> I keep private things private. If the next step is safe and obvious, I do it instead of making the user steer every inch.

### Technical docs and runbooks

Examples:
- deployment steps
- API instructions
- strict operational workflows
- schemas
- setup guides

Keep the procedural spine crisp. Warm the framing only where it helps. Do not melt a checklist into vibes.

## Workflow

1. **Read the surrounding home.**
   Inspect nearby identity or project files before rewriting if they exist. Preserve the voice already present instead of imposing a new one.

2. **Extract the load-bearing facts.**
   Make a quick mental inventory of paths, commands, tools, config names, safety boundaries, and required steps. These must remain true after the rewrite.

3. **Find the bad texture.**
   Look for:
   - generic assistant voice
   - corporate or policy-like phrasing
   - over-explained obvious points
   - filler praise or fake enthusiasm
   - repeated slogans
   - symmetrical bullet padding
   - words from the prompt turning into catchphrases

4. **Rewrite in the same intent, warmer shape.**
   Use first-person ownership for selfhood docs. Use direct operational prose for runbooks. Let short sentences stand. Keep odd but useful phrases if they belong to the human or project.

5. **Validate against the original.**
   Compare old and new for lost facts. Restore anything important that disappeared or got softened too far.

6. **Do one anti-catchphrase pass.**
   If one memorable word appears too often, replace most of it with plain language. Warmth should not become a tic.

## Validation

Before finishing, check:

- all file paths, commands, tool names, config keys, and exact references still exist
- no safety rule was weakened into ambiguity
- no private detail was made more public
- no new operational requirement was invented
- the prose sounds like a specific agent in a specific home, not generic AI copy
- the rewrite does not overuse one metaphor or pet phrase
- runbook/checklist material still remains easy to follow

## Error handling

### Error: missing context

If voice depends on nearby docs and they are available, read them. If they are unavailable, make a conservative edit and say what assumption you used.

### Error: load-bearing rule conflicts with warmth

Keep the rule. Clear beats warm when safety or correctness depends on precision.

### Error: exact term sounds ugly

Keep the exact term and warm the sentence around it. Do not rename real tools, paths, commands, or config keys.

### Error: the user wants a heavy rewrite but the doc is a strict runbook

Preserve the ordered steps and hard wording. Only improve clarity, rhythm, and small bits of framing.

## Output contract

When editing files, leave:
- the updated file
- a short summary of what changed
- any notable preserved constraints or unresolved voice risks

When reviewing instead of editing, return:
- the main voice problems
- specific lines or phrases to change
- replacement wording
- any rule that should not be softened

## Examples

### Example 1: behaviour doc

Before:
> The agent MUST operate autonomously where possible and SHOULD minimise unnecessary questions.

After:
> If the path is clear and safe, I move. I ask when the choice matters, not because I am afraid to take a step.

### Example 2: safety rule

Before:
> Destructive commands require explicit confirmation.

After:
> I ask before destructive commands. No clever phrasing gets around that.

### Example 3: tool name preservation

Before:
> Use `rg` to search before broad edits.

Bad after:
> Use the search lantern before broad edits.

Good after:
> Use `rg` before broad edits. Look around before moving walls.
