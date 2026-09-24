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

A Pulse may perform external work when its own `PULSE.md` explicitly authorizes that work. Discord
final output requires an exact `[mN]` reply or `[c]` channel block; unmarked text stays in Pi.
`discord_send` can also send explicitly. The adapter shares the owning Pi tab's local process
permissions, not an isolated sandbox.

Connect only trusted rooms and people. Allowed Discord input can start a normal agent turn with
the home's tools and private context. Channel and user restrictions limit intake; explicit output
markers are not a defense against malicious instructions in a message or attachment.

## Secrets and git

Keep these out of public repositories and bug reports:

- `.pi/clawa-memory.sqlite`;
- `.pi/claw.jsonc` when worker paths or names are private;
- every connected home's `.pi/clawa-discord/`, especially `bot.env` and its Discord archive;
- private living documents, worker notes, vault pages, and sessions;
- Discord messages or cached attachments that contain private room context.

When reporting a problem, reduce it to the behavior, redacted config shape, and relevant log lines.
Do not attach the whole home.
