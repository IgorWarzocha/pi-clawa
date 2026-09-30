---
title: Configuration
description: Configure workers, naming, and home directories in .pi/claw.jsonc.
section: Reference
order: 110
---

Core runtime configuration lives at `.pi/claw.jsonc`. Pi package loading lives separately at
`.pi/settings.json`. Do not put Clawa worker definitions into Pi settings or package paths into the
Clawa config.

## Complete core shape

```jsonc
{
  "bootstrapped": true,
  "clawas": {
    "baseDir": "clawas",
    "workers": [
      {
        "id": "researcher",
        "title": "Research Clawa",
        "emoji": "🔎",
        "cwd": "clawas/researcher",
        "enabled": true,
        "autostart": true,
        "startupPrompt": "Return to the research lane.",
        "model": "provider/model-id",
        "thinking": "high",
        "reportMode": "auto",
        "extensions": []
      }
    ]
  },
  "clawa": {
    "humanName": "human",
    "mainClawName": "Clawa",
    "clawasName": "Clawas",
    "workerSessionPrefix": "Clawas",
    "controlPlaneDir": "clawas",
    "controlSocketDir": "clawas-control"
  }
}
```

JSON with comments is accepted. Saving through Clawa rewrites normalized JSON without preserving
comments.

Worker session history and terminal handles share `.pi/clawas/session-registry.json` by default. Tab
location is runtime state, not another setting.

## Worker fields

| Field | Meaning |
| --- | --- |
| `id` | Required stable routing ID. |
| `title` | Display name and tab label; defaults to the ID. |
| `cwd` | Required worker home, usually relative to project root. Legacy `workspace` is accepted. |
| `enabled` | Whether the worker is available to the runtime. |
| `autostart` | Whether the main session should open its tab in the background. |
| `startupPrompt` | Prompt used when starting its lane. Legacy `initialPrompt` is accepted. |
| `model` | Optional Pi model selector for this worker. |
| `thinking` | `off`, `minimal`, `low`, `medium`, `high`, or `xhigh`. |
| `fastMode` | Optionally force Fast Mode on or off for this worker when supported by its provider extension. |
| `reportMode` | `auto`, `explicit`, or `off`. |
| `extensions` | Extra extension paths passed to this worker. |

Malformed worker arrays, duplicate IDs, missing IDs/cwds, and invalid worker values
throw visible config errors. Optional fields may be omitted, but a present boolean, thinking level,
report mode, or extension list must have the documented type.

## Continuity settings belong to Pi

Plain Pi owns compaction and overflow recovery. Optional Pi Codex owns its configured continuity.
Clawa no longer has `contextManagement`, `memoryPass`, or `memoryPassThreshold` fields. Remove
those obsolete entries from older configs; do not move them into Pi settings as Clawa options.

House memory and history remain available through `clawa_memory` and `clawa_history`.
`/memory remember` freezes this conversation, starts a fresh one, and queues optional consolidation
at idle. `/memory retry <jobId>` retries a failed job. Consolidation is not a context threshold or
a rollover policy.

## Pi project settings

The stable git-checkout install is:

```json
{
  "packages": ["/absolute/path/to/pi-clawa"]
}
```

To load only Clawa for a diagnostic run without changing settings:

```bash
pi --no-extensions -e /absolute/path/to/pi-clawa
```

Workers run from their own cwd, so Pi project settings discovered there can differ from the main
home. This is useful isolation, but it is also a common source of “works in main, missing in worker.”
When the Discord adapter is loaded with Clawa, it propagates to worker tabs automatically. Each
home's optional Discord settings belong in its own `.pi/clawa-discord/bot.env`, not a worker flag
or the main home's `.pi/claw.jsonc`.
