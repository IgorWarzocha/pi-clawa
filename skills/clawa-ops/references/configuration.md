# Clawa configuration

The Clawa home uses one environment config file:

```text
.pi/claw.jsonc
```

Use it for boot state, home defaults, and subclawa worker definitions. Do not create a second worker config file.

## Shape

```jsonc
{
  "bootstrapped": true,
  "clawas": {
    "baseDir": "clawas",
    "tmuxSession": "clawas",
    "workers": [
      {
        "id": "researcher",
        "title": "Einstein",
        "emoji": "🔎",
        "cwd": "clawas/researcher",
        "enabled": true,
        "autostart": true,
        "model": "provider/model-id",
        "thinking": "medium"
      }
    ]
  },
  "clawa": {
    "mainClawName": "Clawa",
    "clawasName": "Clawas",
    "workerSessionPrefix": "Clawas",
    "controlPlaneDir": "clawas",
    "controlSocketDir": "clawas-control",
    "compaction": {
      "triggerTokens": 130000,
      "summaryMaxTokens": 20000
    }
  }
}
```

## Compaction settings

Optional `clawa.compaction` lives in `.pi/claw.jsonc` as home defaults read by every Pi-Clawa process. The continuity handler uses `summaryMaxTokens` for both Main and workers. Only `triggerTokens` and the automatic compaction policy are Main-only; subclawas do not register the auto-compaction policy.

| Field | Default | Description |
| --- | --- | --- |
| `triggerTokens` | unset | Optional Main-only auto-compaction trigger. Positive safe integer; invalid values are ignored. Fires at `agent_settled` when `usage.tokens >= triggerTokens`. Idle safe-point policy, not a hard per-request ceiling. On owned auto-compact completion, queues a hidden follow-up turn so work continues without waiting for a pulse; manual `/compact` does not auto-continue. |
| `summaryMaxTokens` | `20000` | Continuity summary completion cap for Clawa's custom compaction pass on Main and workers. Independent of Pi `compaction.reserveTokens`. May include provider reasoning. |

**Pi settings scope:** project/root-home `.pi/settings.json` is exact-cwd — Main-only here because Main runs from the home root. Workers run from their own cwd, so project settings do not reach them; dedicated agent-dir or global Pi settings affect workers. Pi native auto-compaction uses those per-process compaction settings and triggers when `usage > contextWindow - reserveTokens`.

Values must be positive safe integers (no decimals). Do not edit live home configs until the package change is reviewed and deployed.

## Worker fields

Required:

- `id` — short stable routing id. Kebab-case is safest.
- `title` — name shown to the home. Can be plain or flavored.
- `cwd` — relative path to the subclawa home.

Common:

- `emoji` — small signature mark.
- `enabled` — set `false` to retire without deleting.
- `autostart` — start with the Clawas runtime.
- `model` — optional Pi model ref.
- `thinking` — `off`, `minimal`, `low`, `medium`, `high`, or `xhigh`.
- `extensions` — optional extra Pi extensions for that worker.
- `reportMode` — `auto`, `explicit`, or `off`.

Less common:

- `startupPrompt` — optional boot cue for unusual lanes. Most subclawas do not need one; their local docs and hydration should carry the shape. If used, keep it generic and do not tell the Clawa to read already-loaded docs.

If you are unsure about model, omit `model` and inherit the current Pi default.

## Discover models

Do not invent model ids. Check what Pi knows:

```bash
pi --list-models
```

Use the `provider/model-id` style that Pi prints or accepts for `--model`. Pick a model only when the human asked for one or the lane clearly needs a different model.

## Editing rules

- Edit `.pi/claw.jsonc` only.
- Append or update the one worker entry you mean to touch.
- Preserve existing workers and home defaults.
- Keep disabled workers if their history or naming lesson may matter later.

## Project Pi settings

Project Pi settings live at:

```text
.pi/settings.json
```

Use them for project-local Pi package loading. Keep main Clawa on Pi's normal session store unless the human explicitly wants a custom session directory; do not edit the human's global `~/.pi/agent/settings.json` when tuning this Clawa home.

Common Clawa shape:

```json
{
  "packages": ["/absolute/path/to/pi-clawa"]
}
```

If the human wants a globally installed package extension disabled only for this Clawa home, use Pi's package filter object in project settings. Example:

```json
{
  "packages": [
    "/absolute/path/to/pi-clawa",
    {
      "source": "npm:some-global-package",
      "extensions": []
    }
  ]
}
```

Omit a resource key to keep loading that resource type. Use `extensions: []` only when the goal is to disable that package's extensions for this home while leaving global settings alone.

If the unwanted extension is an auto-discovered file under `~/.pi/agent/extensions/`, project package filters may not be the right lever. For a clean Clawa-only run, start Pi with extension discovery disabled and add Clawa explicitly:

```bash
pi --no-extensions -e /absolute/path/to/pi-clawa
```

Ask before changing global extension files.
