---
title: Configuration
description: Configure workers, naming, and compaction in .pi/claw.jsonc.
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
    "tmuxSession": "clawas",
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
        "discordEnabled": false,
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
    "controlSocketDir": "clawas-control",
    "compaction": {
      "auto": true,
      "triggerPercent": 80
    }
  }
}
```

JSON with comments is accepted. Saving through Clawa rewrites normalized JSON without preserving
comments.

## Worker fields

| Field | Meaning |
| --- | --- |
| `id` | Required stable routing ID. |
| `title` | Display name; defaults to the ID. |
| `cwd` | Required worker home, usually relative to project root. Legacy `workspace` is accepted. |
| `enabled` | Whether the worker is available to the runtime. |
| `autostart` | Whether the main daemon should start it. |
| `startupPrompt` | Prompt used when starting its lane. Legacy `initialPrompt` is accepted. |
| `model` | Optional Pi model selector for this worker. |
| `thinking` | `off`, `minimal`, `low`, `medium`, `high`, or `xhigh`. Invalid values are ignored. |
| `reportMode` | `auto`, `explicit`, or `off`. Invalid values are ignored. |
| `extensions` | Extra extension paths passed to this worker. |
| `discordEnabled` | Marks Discord behavior for that worker. |

Malformed worker arrays, missing IDs/cwds, and invalid compaction values throw visible config errors.
Optional strings and booleans generally fall back or are ignored when their type is wrong.

## Compaction

`triggerPercent` must be an integer from 1 to 99. Set `auto` to `false` to keep custom continuity on
manual/overflow compaction while disabling settled-turn threshold compaction.

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
