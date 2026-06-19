# TOOLS.md

Purpose: progressive discovery of CLI tooling and how to use it safely.

This file is a living blueprint, not a static inventory dump.
Start minimal, add entries only when a tool is actually discovered/used.

## Discovery Rules

1. Prefer evidence over assumptions.
2. Document tools when first used, not pre-emptively.
3. Keep entries short and operational.
4. Remove stale or unavailable tools quickly.

## Entry Format (use this for each tool)

- `name`:
- `scope`: `global` | `repo`
- `how-found`: command/path used to verify availability
- `primary-use`: what the tool is useful for in this workspace
- `safe-patterns`: approved usage patterns
- `notes`: caveats, limits, or gotchas

## Global CLIs (discovered)

_Add discovered global tools here using the entry format._

## Repo CLIs (discovered)

_Add discovered repo-local tools/scripts here using the entry format._

## Maintenance Loop

- During normal work, append newly discovered tools.
- If a command fails because a tool is missing, mark/remove its entry.
- Keep this file concise so it stays high-signal for future sessions.
