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
branch is genuinely wedged or its compacted history has stopped being useful—not as a daily reset.

## Keep the main room alive

Run the main Clawa inside Herdr, tmux, or another persistent terminal if ambient behavior matters.
The computer being awake is not enough: managed Clawas and Pulses attach to a UI-bearing main Pi
session. Exit that session and their runtime stops.

Main sessions use Pi's normal session store. Managed worker sessions are registered from their own
homes and resumed independently.

## Watch before fixing

The Clawas monitor and Pulse tab are the first operational surfaces:

- `/claw` shows crew configuration, state, and creation controls;
- `/pulse` shows valid and broken Pulse definitions;
- monitor state distinguishes running, busy, stopped, failed, and manual ownership;
- Pulse runs appear as custom messages in the owning session.

If a worker looks stale, first distinguish config drift, a live manual session, a stale socket/process,
session registry trouble, and model authentication failure. Repeatedly editing the worker entry can
make the actual state harder to see.

## Structural health check

The bundled operations skill includes a read-only doctor:

```bash
python ~/src/pi-clawa/skills/clawa-ops/scripts/doctor.py ~/clawa-home
```

It checks core documents, config shape, worker homes, Pulse frontmatter, and rough context sizes. It
does not prove that a model provider, live worker socket, or Discord gateway is healthy, but it catches
many filesystem-level mistakes quickly.
