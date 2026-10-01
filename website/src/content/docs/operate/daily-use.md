---
title: Running it day to day
description: Keep one long-lived home healthy between sessions.
section: Operate
order: 80
---

Most days, start in the home and resume its latest Pi session:

```bash
cd ~/clawa-home
pi -c
```

Use `pi -r` when you need to choose an older main session. Start a new session when the current
session is stuck or its history has stopped being useful, not as a daily reset. Pi handles
compaction when the context grows crowded. If Pi Codex is installed, follow its configured continuity
instead. Keep reusable knowledge in `clawa_memory` and the living docs, regardless of the runtime.

## Keep main running for scheduled work

Run the main Clawa inside Herdr, tmux, or another persistent terminal if you want scheduled work.
The computer being awake is not enough: Pulses need a UI-bearing main Pi session. Worker tabs stay
open through main reloads and exits; Pulses stop when the main session exits.

Main sessions use Pi's normal session store. Worker sessions are registered from their own
homes and resumed independently.

## Check runtime status

Start with the Clawas monitor and Pulse tab:

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

It checks core documents, config, worker homes, Pulse frontmatter, and rough context sizes. It does
not verify model authentication, live worker sockets, or Discord connections. This is an optional
inspection tool, not a first-run requirement.
