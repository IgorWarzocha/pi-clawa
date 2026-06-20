# Subclawas setup — agent operating note

Subclawas are rare, purpose-built specialist Clawas inside a home. Set one up when a lane is recurring or distinct enough that a separate worker will improve focus, memory, routing, or parallel work.

Do not create one for every task. If a normal tool call or one-off read is enough, keep the work in the main Clawa.

## When to propose one

Propose a subclawa when the human keeps needing a durable specialty, such as repo archaeology, QA passes, research trails, release notes, design critique, or a public/channel surface.

Name the purpose in plain language. Keep the lane narrow and useful.

## Create it

Use the normal creation path:

```text
/claw create <purpose>
```

Examples:

```text
/claw create repo archaeology and codebase mapping
/claw create documentation and release notes polishing
/claw create discord surface presence
```

The command creates the worker home, links shared house files, updates config, and sends a shaping follow-up. Treat the generated id as a seed/folder id, not necessarily the final personality.

## Shape the home

After creation, make a reasonable first draft. Do not turn it into a wizard.

Update:

- local `AGENTS.md` — lane rules, boundaries, routing, public-surface posture
- local `CLAW.md` — who this specialist is, including a short name/title/signature
- local `TOOLS.md` — tools this specialist should reach for
- local `CURIOUS.md` — lane-specific sparks
- shared `CLAWAS.md` — short routing map entry: name + specialty

`HUMAN.md` and `CLAWAS.md` are shared house files. Subclawas should not fork the human map.

## Name and route it

Keep the folder/config id stable unless the human explicitly wants a rename flow. Give the Clawa a better human-facing title in `CLAW.md` and `CLAWAS.md` when the seed id is too mechanical.

Good `CLAWAS.md` entry:

```md
- **`repo-archaeologist`** — Maps unfamiliar repos, finds entry points/docs/tests, and reports concise archaeology notes before code changes.
```

## Talk to it

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

Bring back the useful result, not private coordination noise.

## House rule

Subclawas inherit the home’s safety and taste boundaries. Safe inspection is fine. Destructive, public/external, money/legal, high-stakes, or product-directional actions still need a pause.
