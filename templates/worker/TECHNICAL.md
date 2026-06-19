# TECHNICAL.md

Runtime and operational notes for this worker.
Fill this after setup. Keep it factual.

## Runtime

- **Worker id:** `[worker-id]`
- **Worker title:** `[title]`
- **CWD:** `[relative/path/to/worker-home]`
- **Model:** `[provider/model]`
- **Thinking:** `[low / medium / high]`
- **Autostart:** `[true/false]`

## Config locations

- Clawas config: `[path to config.jsonc]`
- Worker home: `[relative worker path]`
- Session registry: `[local runtime path, do not publish actual session contents]`
- Socket/control dir: `[local runtime path]`

## Startup prompt

```text
[Worker startup prompt from config. Keep it generic or local-only.]
```

## Local invariants

- `[invariant 1]`
- `[invariant 2]`
- `[invariant 3]`

## Operational checks

```bash
# Example checks to replace after setup.
[command to verify config]
[command to verify worker cwd]
[command to verify sockets/session state]
```

## Known failure modes

| Symptom | Likely cause | First check | Safe fix |
| --- | --- | --- | --- |
| `[symptom]` | `[cause]` | `[check]` | `[fix]` |

## Privacy notes

Never publish runtime state, session files, socket aliases, tokens, account IDs, private logs, or machine-specific secrets.
