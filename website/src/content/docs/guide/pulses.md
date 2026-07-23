---
title: Pulses
description: Folder-based scheduled wakes, supported schedules, quiet hours, delivery semantics, and why timing is intentionally approximate.
section: Core concepts
order: 60
---

A Pulse is a runnable Markdown definition in a home. It is a gentle wake with local instructions and
memory, not a cron expression hidden in configuration.

## Anatomy

Each Pulse lives at `pulses/<id>/PULSE.md`. Required frontmatter:

```markdown
---
title: Weekly pulse review
schedule: weekly monday 10:00
enabled: true
quietHours: 22:00-08:00
---

Review whether the home's active pulses are still useful...
```

The body owns the actual job, boundaries, targets, and expected finish. A local `AGENTS.md` can hold
the pulse's tiny recurring habits. Notes and results stay in the pulse folder rather than leaking into
a generic scratch pile.

## Schedules

Supported shapes are:

- `manual`
- an interval;
- daily at a local time;
- weekly on a weekday and local time;
- a one-off `at` time.

The bundled `clawa-ops` reference contains the exact accepted frontmatter grammar. Optional
`quietHours: HH:MM-HH:MM` suppresses scheduled wakes in that local-time range; manual runs still run.

Use `/pulse` to inspect Pulses and `/pulse run <id|owner:id|title>` to queue one directly. Qualify the
owner when main and worker homes reuse an ID.

## Runtime behavior

The main scheduler scans roughly every five minutes. It is single-flight, records due state only
after dispatch succeeds, and seeds newly discovered schedules so enabling one does not immediately
fire a stale interval.

Delivery respects current work:

- a main Pulse queues as a Pi follow-up while the main session is busy;
- a managed worker receives a prompt or follow-up according to its activity;
- a manual worker receives socket mail;
- comms and Pulse delivery wait for pending compaction.

If another Pulse for an owner is due at the same time as the default `hey-clawa`, Hey Clawa waits
about 15 minutes to give the specific job the room.

## Operational limits

Pulses are in-process timers. They stop when the UI-bearing main Pi session stops, even if the
computer remains on. They are not cron, systemd, or a hosted scheduler. Five-minute scanning also
means a `10:00` schedule means “around 10:00,” not second-perfect execution.

An unsuccessful dispatch remains eligible on the next scan. This is useful recovery, but a broken
Pulse can retry repeatedly until fixed or disabled. Keep the main TUI observable.

## Good pulse shape

A Pulse should be useful or asleep. Give it one room, explicit external-action boundaries, and a
short result. If it repeatedly produces nothing, edit or disable it. The starter weekly review exists
to catch exactly that kind of automation theatre.
