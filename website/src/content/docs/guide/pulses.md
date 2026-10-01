---
title: Pulses
description: Define scheduled or manual work inside a Clawa home.
section: Core concepts
order: 60
---

A Pulse is scheduled or manual work defined in a home's Markdown files. It runs through the owning
Clawa session with that home's instructions and memory.

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

The body defines the job, boundaries, targets, and expected result. A local `AGENTS.md` can hold
recurring instructions. Keep notes and results in the Pulse folder.

## Schedules

Schedules can be:

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
- a worker receives a prompt or follow-up according to its activity, even while someone types in its tab.

Each successful scheduled delivery is checkpointed immediately. If a later due Pulse fails in the
same scan, work that already landed is not replayed on the next scan.

If another Pulse for an owner is due at the same time as the default `hey-clawa`, Hey Clawa waits
about 15 minutes so the specific job runs first.

## Operational limits

Pulses run inside the main Pi process, not an external scheduler. A `10:00` schedule therefore means
"around 10:00" while that process is alive, not second-perfect execution.

An unsuccessful dispatch remains eligible on the next scan. This is useful recovery, but a broken
Pulse can retry repeatedly until fixed or disabled. Keep the main TUI observable.

## Keep Pulses useful

Give each Pulse one job, explicit external-action boundaries, and a short result. If it repeatedly
produces nothing useful, edit or disable it. The starter weekly review helps identify unused work.
