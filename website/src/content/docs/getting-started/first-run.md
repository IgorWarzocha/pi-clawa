---
title: First run
description: Let Clawa build a new home without overwriting an existing one.
section: Start
order: 20
---

A deliberate project install or explicit `pi -e` makes the first `session_start` the setup path.
Clawa creates `.pi/claw.jsonc`, copies the main home template, and marks the home bootstrapped.
It waits for your first message or task before starting a conversation. A greeting opens natural
introductions; a concrete task gets done first, without an onboarding interview in the way.
No autonomous turn runs while the session opens.

A global install alone does not bootstrap ordinary directories. Without `.pi/claw.jsonc`, Clawa
stays dormant and adds no tools, skills, prompt, or home services. Existing configured homes activate
normally.

## Bootstrap boundary

Automatic bootstrap stops if **any** of these files already exists at the home root:

- `AGENTS.md`
- `CLAW.md`
- `HUMAN.md`
- `CLAWAS.md`
- `CURIOUS.md`
- `TOOLS.md`

This is deliberate. Clawa will not overwrite or guess how to merge identity and relationship files.
Move to a clean home, or inspect and adapt an existing home with the migration guidance in the
bundled `clawa-ops` skill.

`/claw bootstrap` runs the same bootstrap path explicitly. In a headless invocation, `/claw` also
falls back to bootstrap rather than opening the GUI.

## What appears

The main template creates the living documents above, shared `memory/`, and starter Pulses under
`pulses/`. Runtime state then appears under `.pi/` as features are used.

When you want to get acquainted, the conversation calibrates a small set of things:

- the Clawa's name and shape;
- how it should address you;
- what private chat, local notes, and external actions mean in this relationship;
- known facts worth putting in the living documents.

It should not interrogate you, search old sessions without a reason, or turn the exchange into a
policy ceremony. You can correct any assumption in normal conversation. Corrections should land in
the appropriate living file while the context is warm.

## A sensible first session

1. Send a first message, then let the opening conversation find its shape.
2. Read the six root documents. They are meant to be edited.
3. Run `/claw` and look at the home/Clawas view.
4. Run `/pulse` and inspect the two starter Pulses before enabling more scheduled work.
5. Continue the same Pi branch with `pi -c` on later starts instead of opening a fresh identity every
   time.

The home is now live. There is no generated lockstep between template and runtime: future upgrades
do not overwrite your living documents. Read [privacy and trust boundaries](../../reference/privacy/)
before deciding what belongs in those files.
