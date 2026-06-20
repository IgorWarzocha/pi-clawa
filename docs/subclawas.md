# Subclawas — compact operating note

Subclawas are rare, purpose-built specialist Clawas inside a home. Use one when a lane is recurring or distinct enough that a separate worker will improve focus, memory, routing, or parallel work.

Do not create one for every task. If a normal tool call or one-off read is enough, keep the work in the main Clawa.

## When to propose one

Propose a subclawa when the human keeps needing a durable specialty, such as repo archaeology, QA passes, research trails, release notes, design critique, or a public/channel surface.

Name the purpose in plain language. Keep the lane narrow and useful.

## Creation path

Do not invent or expect a creation tool.

The normal creation path is:

```text
/claw create <purpose>
```

If the human has not run it yet, ask them to run that command with the purpose. After creation, wait for the creation follow-up.

Do not hand-edit `.pi/clawas/config.jsonc` or `.pi/claw.jsonc` as the normal creation path. Manual config edits are debugging only.

After creation/reload, shape the new home:

- local `AGENTS.md` — lane rules, boundaries, routing, public-surface posture
- local `CLAW.md` — who this specialist is
- local `TOOLS.md` — tools this specialist should reach for
- local `CURIOUS.md` — lane-specific sparks
- shared `CLAWAS.md` — short routing map entry

`HUMAN.md` and `CLAWAS.md` are shared house files. Subclawas should not fork the human map.

## Talking to one

Use `message_clawa` with the worker id/name/title from `CLAWAS.md` or `.pi/clawas/config.jsonc`.

Send one clear note. Include:

- task goal
- paths or scope
- edit permission: inspect-only or allowed edits
- boundaries, if any
- desired return shape

Example:

```text
Vela here. Inspect-only task: read the playground root and report root markdown files with one-line roles. Check exact paths; do not edit.
```

Do not spam acknowledgments. A message to a subclawa is normally a request for action, not receipt confirmation.

## Handoff behavior

Bring back the useful result, not private coordination noise. Mention exact blockers when routing fails.

Good:

> Read the root docs in this playground and report the files that define the Clawa home shape. Do not edit. Return paths and one-line notes.

Bad:

> Look around and tell me what you think.

## When it fails

- `Unknown Clawas claw` means the worker does not exist in the runtime config yet, or the name does not match.
- `Clawas config must define a workers array` usually means someone hand-edited the config into the wrong shape.
- `Clawas worker at index ... is missing a string id` means the config shape is incomplete.
- `Clawas daemon is not running` usually means the extension/runtime needs to reload after worker creation.
- No response means the worker may still be starting, detached, or stuck; report the exact symptom.

If creation or messaging fails, report the symptom and the file/path involved. Fix clear local config mistakes only when debugging; do not make manual config editing the normal flow.

## House rule

Subclawas inherit the home’s safety and taste boundaries. Safe inspection is fine. Destructive, public/external, money/legal, high-stakes, or product-directional actions still need a pause.
