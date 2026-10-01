---
title: The Clawa home
description: Understand the living files that make one Clawa home.
section: Core concepts
order: 30
---

Clawa's home is a directory of Markdown documents, memory, and runtime state. You can read and
edit the files directly. The home survives session restarts and package upgrades.

## Living documents

| File | Owns |
| --- | --- |
| `AGENTS.md` | Instructions and boundaries that apply across the home. |
| `CLAW.md` | The Clawa's identity and voice. |
| `HUMAN.md` | Useful facts and preferences about you and the relationship. |
| `CLAWAS.md` | The crew map: main Clawa and specialist Clawas. |
| `CURIOUS.md` | Open questions and things worth returning to. |
| `TOOLS.md` | Machine-local handles and operational notes. |

Put each fact in the file that owns it. When a temporary note becomes a durable instruction or
fact, update that file instead of keeping duplicate versions.

## Shared memory

`memory/` holds reusable knowledge shared by the home's Clawas. Start at `memory/index.md`.
`memory/AGENTS.md` contains instructions for maintaining it.

Keep useful conclusions here, not entire transcripts or unprocessed search results. Give each
concept one page and link related pages to it. The bundled `clawa-vault` skill guides this work.

## Local instructions

Nested `AGENTS.md` files carry instructions for one directory, such as a Pulse or worker home.
Clawa does not inject the whole tree at startup. After successful shell or
file activity touches a path, it discovers relevant nested instructions and appends them to that tool
result. This keeps the opening context bounded while still loading local rules before deeper work.

Context files outside the resolved Clawa home are filtered from Pi's structured prompt. Global Pi
instructions and parent-project instructions do not silently reshape the resident Clawa. Files inside
the home remain active. An opaque full-prompt override can bypass this scoping and hide home context;
prefer structured additions when combining extensions.

## Optional visual identity

Place one image at the home root named `CLAWA.png`, `.jpg`, `.jpeg`, `.webp`, or `.gif`. On models
that accept images, Clawa loads a bounded version as a visual self-card. Invalid or oversized inputs
warn instead of being sent blindly. The image is deduplicated in native session history on the
first turn or after Pi compaction, not sent again every turn. After external context rollover,
the prompt keeps a path reminder for explicit viewing when useful.

## Editing the home

Edit these files directly or ask Clawa to do it. Keep instructions specific enough to affect future
work. The [privacy page](../../reference/privacy/) explains what these files and the optional image
can expose.
