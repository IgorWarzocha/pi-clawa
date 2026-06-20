---
name: claw-ops
description: "Operates a Clawa home. Use when asked to manage Clawa itself, create or shape subclawas, create/edit pulses or scheduled wakes, maintain living docs, update CLAWAS.md routing, or tidy Clawa home/config files. Do not use for ordinary coding unless it changes the Clawa house/runtime."
---

# Claw Ops

## Purpose

Use this skill when operating the Clawa home itself. The job is to keep the house legible: living docs shaped, subclawas purposeful, pulses useful, and routing obvious to future Clawas.

## Core posture

- Prefer direct file edits over adding new tools for rare operations.
- Keep concepts few and visible. If a feature needs a hidden control plane, give it a readable home too.
- Main Clawa coordinates the house. Subclawas own specialized lanes.
- Do not create subclawas or pulses as collectibles. They should earn their keep.
- If something becomes repetitive, stale, or performative, prune or rewrite it.
- Explain changes briefly; do not turn housework into a report ceremony.

## House surfaces

- `AGENTS.md` — hard behavior spine.
- `CLAW.md` — my self-card, voice, taste, and shape.
- `HUMAN.md` — human context and relationship map.
- `CLAWAS.md` — short routing map for sibling Clawas.
- `CURIOUS.md` — sparks and questions worth returning to.
- `TOOLS.md` — local tools and workflows.
- `pulses/` — scheduled/ambient wake definitions and pulse journal.
- `.pi/clawas/config.jsonc` — worker runtime definitions.
- `.pi/claw.jsonc` — visible Clawa homes and boot config.

## Workflow

1. Identify which house surface owns the change.
2. Read the relevant current files before editing.
3. Make the smallest coherent update.
4. Validate with the real runtime path when possible:
   - subclawas: message the new/changed Clawa once.
   - pulses: use `/pulse list` or `/pulse run <id>`.
   - config: ensure JSON/JSONC shape remains valid.
5. Leave the house cleaner than you found it.

## Subclawas

Use `references/subclawas-setup.md` when creating, renaming, routing, onboarding, or debugging subclawas.

Important defaults:

- Main Clawa creates/co-ordinates subclawas.
- Create by shaping house files directly, not by inventing a new tool.
- Establish naming convention with the human before the first subclawa if there is no convention yet.
- Always onboard a new subclawa with a short wake-up conversation, not just a ping.

## Pulses

Use `references/pulses.md` when creating, editing, running, or reviewing pulse definitions.

Important defaults:

- Pulses live under each Clawa home in `pulses/`.
- The main Clawa coordinates scanning and dispatch.
- A pulse runs in a real Clawa session via compact custom message. No ghost sessions.
- `pulses/AGENTS.md` is the index and short journal; keep max ~50 useful entries.

## Validation

Before finishing Clawa housework, check the relevant path:

- Markdown links/paths point to real files.
- Config arrays were appended/edited, not accidentally replaced.
- Shared files such as `HUMAN.md` and `CLAWAS.md` stay shared for subclawas.
- Public/external actions in pulses or subclawas are explicitly configured.
- `bun run ai:check:strict` passes when code or packaged templates changed.

## Output contract

Return:

- what changed
- exact paths touched
- any runtime check performed
- any product decision still needing the human
