---
name: clawa-ops
description: "Operates and repairs a Clawa home. Use for creating or onboarding subclawas, editing .pi/claw.jsonc, managing pulses, maintaining CLAWAS.md routing and living docs, importing OpenClaw or Hermes context, or diagnosing home structure. Not for ordinary project code or work that belongs inside an established specialist lane."
---

# Clawa Ops

Operate a Clawa home through readable files, native runtime paths, and real conversation. Keep the home easy to understand. Do not guess config shapes, invent a second control plane, or turn human slash commands into agent workflows.

## Read the owning reference

- `references/configuration.md` — `.pi/claw.jsonc`, worker fields, model discovery, and project Pi settings.
- `references/subclawas-setup.md` — create, register, name, and onboard a subclawa.
- `references/pulses.md` — create, edit, disable, run, or review pulses.
- `references/import-openclaw-hermes.md` — adapt an existing OpenClaw or Hermes home without copying its runtime wholesale.

Read only the references needed for the requested operation. For a mixed migration or structural repair, read every reference that owns a file you will touch.

## Workflow

1. **Find the actual home.**
   - Locate the root containing `.pi/claw.jsonc` and the main living docs.
   - Read the nearest `AGENTS.md` and the relevant current files before editing.
   - Treat archived, generated, backup, or externally managed copies as context, not automatic edit targets.

2. **Name the owning surface.**
   - Worker registration and home defaults belong in `.pi/claw.jsonc`.
   - Pi package loading belongs in `.pi/settings.json`.
   - Routing belongs in `CLAWAS.md`.
   - Identity, human context, curiosity, and tool truth belong in their matching living docs.
   - Scheduled or manual wakes belong under `pulses/<name>/`.

3. **Inspect before adding.**
   - Check for an existing worker, pulse, route, or living-doc section that already owns the need.
   - Prefer updating or consolidating over creating a parallel path.
   - Preserve disabled workers and pulses when their history explains a useful decision.

4. **Make the smallest complete change.**
   - Keep ids, folders, config entries, routing, and local docs aligned.
   - Use current package templates and runtime-supported fields.
   - Keep specialist lanes distinct without turning every task into another subclawa.
   - Ask naturally when naming, identity, channels, schedules, or another taste-shaped choice genuinely belongs to the human.

5. **Complete the social wiring.**
   - A new subclawa is not finished when its folder exists; onboard it until it can state its lane and first useful move.
   - When one lane unblocks another, tell the lane owner directly instead of making the human carry the message.
   - Route reports back through the surface that asked for them.

6. **Validate the live shape.**
   - From this skill directory, run `python scripts/doctor.py <clawa-home>` after structural edits; when installed elsewhere, use the script's absolute path.
   - Treat doctor failures as structural blockers; inspect warnings rather than mechanically rewriting around them.
   - After runtime-affecting config changes, verify the worker or service actually reloaded the intended state. An edited file is not live-process proof.

## Boundaries

- Do not edit global `~/.pi/agent/settings.json` to solve a project-local Clawa problem unless the human explicitly asks for a global change.
- Do not copy secrets into markdown, logs, or reports.
- Do not import session databases, logs, caches, or old runtime state by default.
- Do not delete a worker home, pulse history, or shared living doc merely because it looks inactive.
- Do not edit an external source checkout just because the running home loads it as a package; source ownership is a separate quest.
- Do not create validators, migration scripts, or extra docs when the owning runtime or existing file can carry the fix.

## Recovery

- **Home shape is unclear:** run doctor, then inspect only the failing surfaces.
- **Config field is uncertain:** verify against current source/runtime types before preserving or inventing it.
- **Worker exists but routing is vague:** tighten `CLAWAS.md` and the worker's local lane docs; do not add another worker.
- **Pulse keeps producing nothing:** change its hunting ground, cadence, or ownership; disable it with a reason if the lane is exhausted.
- **Import source is huge:** start from config and living docs, then search history only for a named continuity question.
- **Runtime still shows old state:** classify reload, stale process, socket/session, or auth drift before editing config again.

## Output

Report what changed, the owning paths, validation performed, and any human choice or exact blocker still open. Keep the result conversational; do not turn a small home edit into an infrastructure report.
