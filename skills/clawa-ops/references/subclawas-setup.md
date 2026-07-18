# Subclawa setup

A subclawa is a specialized Clawa with its own home and lane. Create one when the home needs a recurring specialty or surface: research, travel planning, inbox triage, family logistics, writing polish, finance watching, community/chat presence, health routines, archive digging, or another clear lane.

Do not create one for every task. If a normal tool call or note is enough, keep the home small.

## Naming

For the first subclawa, establish the naming convention with the human if it is not obvious. Guess from their taste if you can; ask one small question if you cannot.

Names must be obvious for routing but can carry home flavor:

- `researcher`
- `research-clawa`
- `einstein`

Use short ids, usually one or two useful words. Three is already a stretch. Keep `id`, folder name, and `CLAWAS.md` routing aligned unless there is a deliberate reason not to.

## Create the home

If the human already used Clawa's native create flow, the seed, config entry, shared links, and routing stub may already exist. Inspect that result and continue with onboarding instead of creating a second copy.

For an agent-driven manual setup:

1. Pick `id`, `title`, `emoji`, and home path under `clawas/`.
2. Create the folder.
3. Copy the package's worker templates. From this skill directory they live at:

```text
../../templates/worker/AGENTS.md
../../templates/worker/CLAW.md
../../templates/worker/CURIOUS.md
../../templates/worker/TOOLS.md
../../templates/worker/pulses/AGENTS.md
```

Copy them into the same relative paths under `clawas/<id>/`; the pulse index stays at `pulses/AGENTS.md`.

4. Symlink shared home context:

```bash
ln -s ../../HUMAN.md clawas/<id>/HUMAN.md
ln -s ../../CLAWAS.md clawas/<id>/CLAWAS.md
```

Do not hand-shape the local docs before onboarding unless the human explicitly asked for that. Seed from templates, then let the subclawa help become itself.

## Register it

Edit `.pi/claw.jsonc`. Append one entry under `clawas.workers` and keep existing entries.

```jsonc
{
  "id": "researcher",
  "title": "Einstein",
  "emoji": "🔎",
  "cwd": "clawas/researcher",
  "enabled": true,
  "autostart": true,
  "model": "provider/model-id",
  "thinking": "medium"
}
```

`model` is optional. Discover available Pi models with `pi --list-models` before setting it. If unsure, omit it.

Update `CLAWAS.md` with a short agent-facing routing line:

```md
- **`researcher`** — research trails, source gathering, and synthesis when a topic needs a persistent lane.
```

## Onboard it

Use `message_clawa` to start a real onboarding conversation. This is not a one-ping sanity check.

Cover, through natural back-and-forth:

- why it exists
- what lane it owns
- what belongs elsewhere
- what name/signature feels right
- how it should report back
- any model/tooling expectations for the lane

Start small. Do not make the first message a tour of every file in its home. Let `TOOLS.md`, `CURIOUS.md`, and `pulses/AGENTS.md` enter the conversation only when the lane actually needs them.

Let it adjust its local docs as the conversation settles. Keep going until it has enough shape to operate without freezing, then ask it for a short summary of its lane and first useful next move.

After onboarding, run doctor and verify the managed worker is live on its configured model/thinking identity. A successful private reply proves the route; inspect live session identity when the exact model matters.

## Talk to it later

Use `message_clawa` with the id/title from `CLAWAS.md` or `.pi/claw.jsonc`.

For normal work, talk like you would to a specialist: give the goal, the useful context, and where to report back. For onboarding or lane-shaping, keep it conversational and iterative.
