---
title: Troubleshooting
description: Diagnose bootstrap blocks, missing workers, stale sessions, silent Pulses, context trouble, package loading, and Discord gateway state.
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

Any existing core root document blocks automatic bootstrap. Clawa will not merge it. Use a clean
folder or manually reconcile the existing files with the templates. Do not set `bootstrapped: true`
just to silence the error; that produces an explicit half-home.

## A worker will not start

- Validate `.pi/claw.jsonc`: every worker needs an ID and cwd.
- Check `enabled`, `autostart`, model name, and provider auth.
- See whether the monitor marks it manual. Managed delivery intentionally disconnects then.
- Confirm the worker cwd still belongs to the session recorded in `.pi/clawas/session-registry.json`.
- Stop duplicate manual Pi processes before removing stale runtime sockets.

Use `/steer` and watch the reported error. The runtime restores prior state when delivery fails, so a
worker that still says “busy” may indicate another owner rather than a swallowed steer.

## Pulses are silent

- The main Pi TUI must remain running.
- The Pulse needs valid frontmatter and `enabled: true`.
- Quiet hours may suppress scheduled—but not manual—runs.
- New schedules are seeded rather than fired immediately.
- Timing is approximate to the five-minute scanner.
- A delivery failure leaves the Pulse eligible for retry.

Try `/pulse run owner:id`. If a title is ambiguous, target by qualified ID. Inspect `.pi/pulses.json`
only after checking the visible Pulse definition and owning session.

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
- Inspect `.pi/clawa-discord/gateway.log` with secrets and message content in mind.
- Determine whether this Pi session owns or merely adopted the gateway before killing processes.

The adapter is WIP. When the behavior is reproducible, include the expected route, observed route,
and redacted gateway error in an issue.
