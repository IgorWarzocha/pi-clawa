---
title: Privacy and trust boundaries
description: Know what remains local, what reaches providers, and where policy ends.
section: Reference
order: 140
---

Clawa's privacy posture is a behavioral contract carried in the home, not an operating-system
sandbox. The extension runs with the same user permissions as Pi. Installed extensions can execute
code and read files available to that user.

## Provider boundary

Every model call can include:

- the active conversation and relevant Pi context;
- hydrated `CLAW.md`, `HUMAN.md`, `CLAWAS.md`, `CURIOUS.md`, and `TOOLS.md`;
- an optional root `CLAWA` image;
- nested instructions reached during work;
- recalled material when the model explicitly uses `recall`.

Therefore “stored locally” does not mean “never sent to a provider.” Choose a provider appropriate
for the home's material. Never put credentials, tokens, recovery codes, or private account IDs in
living documents or visual identity assets.

SQLite memory is not injected automatically, but matching rows can be returned by `recall` and then
enter conversation context.

## Home isolation

Clawa excludes global and outside-parent instruction files from its prompt while preserving
instructions physically inside the home. This isolates persona and operating posture; it does not
block file tools from reading outside the home when normal Pi permissions and instructions allow it.

`.pi/SYSTEM.md` is ignored to avoid conflicting identity prompts. `.pi/APPEND_SYSTEM.md` remains the
supported Pi-level addition point.

## External action

Onboarding calibrates local notes, private chat, and external action in ordinary conversation. The
result guides model judgment. It is not a separate permission engine that technically prevents every
send or command.

A Pulse may perform external work when its own `PULSE.md` explicitly authorizes that work. Public
Discord output requires explicit route blocks, which is a stronger delivery guard on that adapter,
but the Discord worker and gateway still operate with local process permissions.

## Secrets and git

Keep these out of public repositories and bug reports:

- `.pi/clawa-memory.sqlite`;
- `.pi/claw.jsonc` when worker paths or names are private;
- `.pi/clawa-discord/`, especially `config.env`;
- private living documents, worker notes, vault pages, and sessions;
- gateway logs containing room or delivery context.

When reporting a problem, reduce it to the behavior, redacted config shape, and relevant log lines.
Do not attach the whole home.
