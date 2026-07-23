---
title: Troubleshooting
description: Start at the owning layer when part of the home misbehaves.
section: Reference
order: 150
---

Start with the owning layer. A package-load problem, home-shape problem, worker daemon problem, model
auth problem, and Discord gateway problem can look similar from the final conversation.

## Clawa did not appear

1. Run `pi -e /absolute/path/to/pi-clawa` from the intended home.
2. Check that Node satisfies `>=24.15.0 <27`.
3. Check `.pi/settings.json` if plain `pi` fails but `-e` works.
4. Run `pi --no-extensions -e /absolute/path/to/pi-clawa` to isolate extension conflicts.
5. Inspect Pi's startup error rather than adding another copy of the package path.

## Bootstrap was blocked

Use the exact file list in [First run](../../getting-started/first-run/). Reconcile those files or move
to a clean home; setting `bootstrapped: true` only turns the blockage into a half-home.

## A worker will not start

- Validate `.pi/claw.jsonc`: every worker needs an ID and cwd.
- Check `enabled`, `autostart`, model name, and provider auth.
- See whether the monitor marks it manual. Managed delivery intentionally disconnects then.
- Confirm the worker cwd still belongs to the session recorded in `.pi/clawas/session-registry.json`.
- Stop duplicate manual Pi processes before removing stale runtime sockets.

Use `/steer` and watch the reported error. The runtime restores prior state when delivery fails, so a
worker that still says “busy” may indicate another owner rather than a swallowed steer.

## Pulses are silent

Try `/pulse run owner:id` first. Then check the visible definition, quiet hours, and owning session
against the [Pulse runtime rules](../../guide/pulses/). Inspect `.pi/pulses.json` only after those
surfaces look right.

## Identity feels stale after compaction

The next provider call should rehydrate the five living files. Check that the files are under the
resolved home, within the documented bounds, and not replaced by an outside instruction file you
expected Clawa to load. Custom `.pi/SYSTEM.md` is ignored; use `.pi/APPEND_SYSTEM.md`.

For structural checks:

```bash
python /absolute/path/to/pi-clawa/skills/clawa-ops/scripts/doctor.py /path/to/home
```

## Discord is connected but does not reply

- Untagged final text is intentionally not delivered.
- The worker must use a known `[#channel]`, `[dm]`, `[main_clawa]`, or `[quiet]` route.
- Check `.pi/clawa-discord/routes.jsonc` names and the gateway channel snapshot.
- Inspect `.pi/clawa-discord/gateway.log`.
- Determine whether this Pi session owns or merely adopted the gateway before killing processes.
