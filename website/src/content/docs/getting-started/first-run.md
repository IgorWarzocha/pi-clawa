---
title: First run
description: Let Clawa build a new home without overwriting an existing one.
section: Start
order: 20
---

Start Pi from the clean home directory using the project install or explicit `pi -e` path from
[Installation](../installation/). Clawa creates `.pi/claw.jsonc`, copies the main home template,
and marks the home bootstrapped.

It then waits for your message. Say hello to get acquainted, or give it a task. A concrete task
comes before introductions. Opening the session does not start an autonomous turn.

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
Use a clean home, or inspect and adapt an existing home with the migration guidance in the
bundled `clawa-ops` skill. Do not set `bootstrapped: true` to bypass a conflict.

`/claw bootstrap` runs the same bootstrap path explicitly. In a headless invocation, `/claw` also
falls back to bootstrap rather than opening the GUI.

## What appears

The main template creates the living documents above, shared `memory/`, and starter Pulses under
`pulses/`. Runtime state then appears under `.pi/` as features are used.

Introductions help establish:

- the Clawa's name and voice;
- how it should address you;
- what private chat, local notes, and external actions mean in this relationship;
- known facts worth putting in the living documents.

You can change those answers in normal conversation. Clawa should update the relevant living
file, not make you repeat an onboarding form.

## A sensible first session

1. Say hello or send your first task.
2. Read the six root documents. They are meant to be edited.
3. Run `/claw` to inspect the home and crew.
4. Run `/pulse` and inspect the two starter Pulses before enabling more scheduled work.
5. On later starts, run `pi -c` from this home to continue the most recent Pi session. This is a Pi
   conversation branch, not the package's Git branch.

Future package upgrades do not overwrite your living documents. Read
[privacy and trust boundaries](../../reference/privacy/)
before deciding what belongs in those files.
