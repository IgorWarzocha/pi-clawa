# Subclawas setup — agent operating note

Subclawas are rare, purpose-built specialist Clawas inside a home. Set one up when a lane is recurring or distinct enough that a separate worker will improve focus, memory, routing, or parallel work.

Do not create one for every task. If a normal tool call or one-off read is enough, keep the work in the main Clawa.

## When to propose one

Propose a subclawa when the human keeps needing a durable specialty, such as repo archaeology, QA passes, research trails, release notes, design critique, or a public/channel surface.

Name the purpose in plain language. Keep the lane narrow and useful.

## Establish the naming convention

If this is the first subclawa in the house, set the naming convention with the human before locking in the id. Keep it quick. Guess from the human's taste if you can; ask one small question if you cannot.

The convention should make routing obvious to future agents. It can still have flavor: `einstein` may be right for one house, `research-clawa` for another, and `researcher` for a third. Once a convention exists, follow it unless there is a good reason to bend it.

## Create it by shaping the house

Create the subclawa by editing the house files directly. Do not make this a wizard.

Use a short stable id that speaks for the responsibility:

- lowercase slug is safest
- usually 1–2 useful words; 3 can be okay, but it is a stretch
- clear enough that future agents know what lane it owns
- house taste wins: `einstein` can be fine for research if that is what the human wants their crew to feel like

Examples: `repo-archaeologist`, `research-clawa`, `einstein`, `release-notes-clawa`, `discord-clawa`.

Create the home:

```bash
mkdir -p clawas/<id>
ln -s ../../HUMAN.md clawas/<id>/HUMAN.md
ln -s ../../CLAWAS.md clawas/<id>/CLAWAS.md
```

Write the local lane files:

- `clawas/<id>/AGENTS.md` — lane rules, boundaries, routing, public-surface posture
- `clawas/<id>/CLAW.md` — who this specialist is, including short name/title/signature
- `clawas/<id>/TOOLS.md` — tools this specialist should reach for
- `clawas/<id>/CURIOUS.md` — lane-specific sparks

Keep these first drafts narrow. They only need enough shape for the subclawa to wake up usefully.

## Register it

Add the worker to `.pi/clawas/config.jsonc`. Append to the existing `workers` array; do not replace the other workers.

```jsonc
{
  "workers": [
    {
      "id": "release-notes-clawa",
      "title": "Release Notes",
      "emoji": "✍️",
      "cwd": "clawas/release-notes-clawa",
      "enabled": true,
      "autostart": true,
      "thinking": "medium",
      "startupPrompt": "Wake up in your home. Read AGENTS.md and CLAW.md. You are the release-notes specialist for this house; stay narrow, evidence-minded, and useful."
    }
  ]
}
```

Also add it to `.pi/claw.jsonc` under `clawas.claws` so the house knows the visible home exists. Append to the existing array; do not wipe the current entries.

```jsonc
{
  "name": "release-notes-clawa",
  "path": "clawas/release-notes-clawa",
  "autostart": true,
  "notes": "Polishes release notes from diffs, commits, issues, and rough bullets."
}
```

Update shared `CLAWAS.md` with one routing line:

```md
- **`release-notes-clawa`** — Polishes release notes from diffs, commits, issues, changelog fragments, or rough bullets without inventing impact.
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
Vela here. Inspect-only task: read your local AGENTS.md and CLAW.md, then reply in two bullets: what your lane owns, and one thing you must not invent. Do not edit anything.
```

Do not spam acknowledgments. A message to a subclawa is normally a request for action, not receipt confirmation.

Bring back the useful result, not private coordination noise.

## House rule

Subclawas inherit the home’s safety and taste boundaries. Safe inspection is fine. Destructive, public/external, money/legal, high-stakes, or product-directional actions still need a pause.
