# Clawa configuration

The Clawa house uses one environment config file:

```text
.pi/claw.jsonc
```

Use it for boot state, house defaults, and subclawa worker definitions. Do not create a second worker config file.

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
    "controlSocketDir": "clawas-control"
  }
}
```

## Worker fields

Required:

- `id` — short stable routing id. Kebab-case is safest.
- `title` — name shown to the house. Can be plain or flavored.
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
- Preserve existing workers and house defaults.
- Keep disabled workers if their history or naming lesson may matter later.
