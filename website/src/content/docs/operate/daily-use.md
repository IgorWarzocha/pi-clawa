---
title: Running it day to day
description: Keep one long-lived home healthy between sessions.
section: Operate
order: 80
---

Clawa is designed around one long-lived home and ordinary Pi session semantics. Most days, start in
the home and continue the branch:

```bash
cd ~/clawa-home
pi -c
```

Use `pi -r` when you need to choose an older main session. Start a new session when the current
branch is genuinely wedged or its history has stopped being useful, not as a daily reset. In local
context mode, checkpoint useful state into notes and use `new_context` when a window grows crowded.

## Keep the main room alive

Run the main Clawa inside Herdr, tmux, or another persistent terminal if ambient behavior matters.
The computer being awake is not enough: Pulses need a UI-bearing main Pi session. Worker tabs stay
open through main reloads and exits; Pulses stop when the main session exits.

Main sessions use Pi's normal session store. Worker sessions are registered from their own
homes and resumed independently.

## Watch before fixing

The Clawas monitor and Pulse tab are the first operational surfaces:

- `/claw` shows crew configuration, state, and creation controls;
- `/pulse` shows valid and broken Pulse definitions;
- monitor state distinguishes running, busy, stopped, and failed workers;
- Pulse runs appear as custom messages in the owning session.

If a worker looks stale, first distinguish config drift, a closed tab, a stale socket,
session registry trouble, and model authentication failure. Repeatedly editing the worker entry can
make the actual state harder to see.

## Structural health check

The bundled operations skill includes a read-only doctor:

```bash
python ~/src/pi-clawa/skills/clawa-ops/scripts/doctor.py ~/clawa-home
```

It checks core documents, config shape, worker homes, Pulse frontmatter, and rough context sizes. It
does not prove that a model provider, live worker socket, or Discord connection is healthy, but it catches
many filesystem-level mistakes quickly.
