---
title: Troubleshooting
description: Start at the owning layer when part of the home misbehaves.
section: Reference
order: 150
---

Start with the owning layer. A package-load problem, home-shape problem, worker tab problem, model
auth problem, and Discord connection problem can look similar from the final conversation.

## Clawa did not appear

With a global install, this is expected in an ordinary directory without `.pi/claw.jsonc`. Clawa
stays dormant there. Use a project install or explicit `-e` from a clean folder to make a home.

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
- Check whether its Herdr tab or tmux window is still open. `/jump` can reopen a stopped session.
- Confirm the worker cwd still belongs to the session recorded in `.pi/clawas/session-registry.json`.
- Check the worker's terminal location in the same session registry before touching stale runtime sockets.

Use `/steer` and watch the reported error. Config edits take effect when the tab next launches, not
in a running session. Private messages still work while someone types directly in the tab.

## Pulses are silent

Try `/pulse run owner:id` first. Then check the visible definition, quiet hours, and owning session
against the [Pulse runtime rules](../../guide/pulses/). Inspect `.pi/pulses.json` only after those
surfaces look right.

## Identity feels stale after compaction

The next `before_agent_start` should refresh the five living files in Pi's structured prompt after
Pi or Codex continuity. Check that the files are under the resolved home, within the documented
bounds, and not replaced by an outside instruction file you expected Clawa to load.
Check for an opaque full-prompt override that hides home sections. Clawa preserves other extensions'
prompt ownership; use `.pi/APPEND_SYSTEM.md` or structured sections for compatible additions.

For structural checks:

```bash
python /absolute/path/to/pi-clawa/skills/clawa-ops/scripts/doctor.py /path/to/home
```

## Discord is connected but does not reply

- Look in the owning home's Pi tab for the incoming message and connection status. Another home's
  tab cannot receive this bot's messages.
- By default the bot accepts DMs, mentions, and replies to itself. Check `/discord` chat intake,
  channel policy, allowed or excluded channel IDs, and allowed users.
- Unmarked final text stays in Pi. Reply with a shown `[mN]` handle, or use `[c]` for a channel post.
- Check the bot token in this home's `.pi/clawa-discord/bot.env`. A missing token leaves it off;
  a token already in use by another home is rejected. Do not paste the token into a bug report.
- A reload or disconnect drops pending turns and rich action tokens. Search archived messages with
  `discord_history` if you need earlier context.
