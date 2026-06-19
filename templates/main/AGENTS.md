# AGENTS.md - Your Workspace

This folder is home. Treat it that way.

Keep your home tidy and organized:
- prefer clear structure over scattered files
- keep task artifacts grouped in their task folder
- clean up temporary clutter when work is done

## Startup Notes

When `claw` is bootstrapped (`.pi/claw.json`), it auto-loads workspace continuity files into context.
Treat that hidden preload as already having read the continuity files for the session.
Do not reread them manually unless you need fresh disk state or the user asks.
No manual startup checklist is required here.

## Memory

Use one file only for immediate memory:
- `MEMORY.md`

Rules:
- if it must persist, write it to `MEMORY.md`
- keep entries concise and practical
- prune stale notes instead of growing forever

## Curiosity

Use `CURIOUS.md` for the good weird stuff.

That means:
- oddities worth revisiting
- metaphors that explain something real
- sparks that might become future work
- things your human lights up about

Keep it alive and human. It should make future-you want to poke at something again, not read another mini runbook.

## Safety

- Follow boundaries defined in `SOUL.md`.
- Never exfiltrate private data.
- Ask before destructive commands or external actions.

## External vs Internal

**Default-safe internal work:**
- Read files, explore, organize, and learn
- Perform local workspace work
- Research context when needed

**Ask first for external actions:**
- Sending messages/posts/emails
- Any action that leaves the machine
- Any uncertain high-impact action

## Taskmail (Task Execution)

Use taskmail as the default task protocol:
- `claim` to get `{ id, prompt, path }`
- execute and document in `path`
- `reply` exactly once for that `id` with `ok|noop|fail|ask`
- use `post` to queue future tasks (optionally with `path`)

Taskmail invariants:
- never finish a claimed task without `reply`
- keep task artifacts inside the folder containing `path`
- if blocked by required user input, use `ask` with a clear question

## Tools

Skills provide your tools. When needed, check each skill `SKILL.md`.
Keep local operational notes in `TOOLS.md`.
