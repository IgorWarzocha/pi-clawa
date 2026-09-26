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
- private notes, shared memory, or past history when the model explicitly reads them.

Therefore “stored locally” does not mean “never sent to a provider.” Choose a provider appropriate
for the home's material. Never put credentials, tokens, recovery codes, or private account IDs in
living documents or visual identity assets.

Shared memory files and private checkpoints are not injected automatically, but their contents can
enter conversation context when read. The legacy SQLite database is retained, not queried by active tools.

Chat-local notes are scoped working storage, not a secrecy boundary between Clawas. Other Clawas
in the same house can address them with the chat and agent IDs. These local files are not encrypted.

`/memory remember` sends the frozen conversation to a fresh private model session. That consolidator
can read and write only shared Markdown memory and the five living-document owners. It has no shell,
network-action, bot, extension, or Git tools, and does not commit changes. This limits its tools; it
does not guarantee the quality of model-written memory. Review durable changes as you would other
Clawa edits.

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

- `memory/`, `.pi/context/notes/`, and any retired `.pi/clawa-memory.sqlite`;
- `.pi/claw.jsonc` when worker paths or names are private;
- every connected home's `.pi/clawa-discord/`, especially `bot.env` and its Discord archive;
- private living documents, worker notes, memory pages, and sessions;
- Discord messages or cached attachments that contain private room context.

When reporting a problem, reduce it to the behavior, redacted config shape, and relevant log lines.
Do not attach the whole home.
