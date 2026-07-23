---
title: The Clawa home
description: Understand the living files that make one Clawa home.
section: Core concepts
order: 30
---

The filesystem is Clawa's durable home. Markdown is not a settings UI bolted onto the runtime; it is
the readable layer where identity and relationship can keep changing without a database inspector.

## The root spine

| File | Owns |
| --- | --- |
| `AGENTS.md` | The posture and boundaries that should touch every future reply. |
| `CLAW.md` | The Clawa's identity, voice, instincts, and evolving shape. |
| `HUMAN.md` | Relationship texture and useful facts about the human. |
| `CLAWAS.md` | The crew map: main Clawa and specialist Clawas. |
| `CURIOUS.md` | Live questions, sparks, and things worth returning to. |
| `TOOLS.md` | Machine-local handles and operational notes. |

These files have different jobs so one giant memory document does not become a mystery drawer.
When a raw remembered note becomes settled truth, shape it into the owning file rather than keeping
both copies forever.

## The shared vault

`vault/` is the house's second brain: compiled, reusable knowledge that would be costly or ambiguous
to rebuild. Its `index.md` is the front door. `vault/AGENTS.md` keeps the rules local to the vault.

The vault is not a dump for transcripts, search results, or generic facts. One concept should own the
truth; related pages link to it. The bundled `clawa-vault` skill gives the Clawa the operating pattern
for finding, integrating, and reorganizing this knowledge.

## Tiny local instructions

Nested `AGENTS.md` files carry durable context for one directory: a pulse's habits, a worker's lane,
or a vault area's sharp edges. Clawa does not eagerly inject the whole tree. After successful shell or
file activity touches a path, it discovers relevant nested instructions and appends them to that tool
result. This keeps the opening context bounded while still loading local rules before deeper work.

Instructions outside the resolved Clawa home are filtered from Clawa's system prompt. Global Pi
instructions and parent-project instructions do not silently reshape the resident Clawa. Files inside
the home remain active.

## Optional visual identity

Place one image at the home root named `CLAWA.png`, `.jpg`, `.jpeg`, `.webp`, or `.gif`. On models
that accept images, Clawa loads a bounded version as a visual self-card. Invalid or oversized inputs
warn instead of being sent blindly.

## Editing the home

Edit these files directly or ask Clawa to do it. Prefer small, accurate updates over biographies and
grand declarations. The useful test is whether the next session behaves better because the sentence
is there. The [privacy page](../../reference/privacy/) owns what these files and the optional image
can expose.
