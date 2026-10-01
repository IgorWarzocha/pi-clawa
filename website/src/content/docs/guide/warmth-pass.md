---
title: Speaking hooman
description: Keep identity-bearing home docs human without losing their operational contracts.
section: Core concepts
order: 35
---

Clawa should sound like someone you know, not the same polite assistant in every home. Its living
documents hold the voice and relationship. The bundled `warmth-pass` skill helps keep those
instructions personal without making them less precise.

## The bundled warmth pass

Use `warmth-pass` for `AGENTS.md`, `CLAW.md`, `HUMAN.md`, `CURIOUS.md`, worker-home docs, and other
identity-bearing text. It removes generic assistant phrasing and stiff policy language without
changing the instructions.

These survive unchanged:

- exact paths, commands, tool names, and config keys;
- safety, privacy, permission, and ownership boundaries;
- required steps, stop conditions, and output contracts;
- names, roles, relationship facts, and deliberate odd phrases.

The pass should preserve the home's own voice, not add a mascot, catchphrases, or forced jokes.
If a warmer sentence is less precise, keep the precise one.

## Keeping the voice in context

Clawa reloads the five living documents before each agent turn, including after compaction.
Edits therefore affect later turns without needing to repeat a style request in chat.
Specialists have their own identity documents and share the human and crew map.

## When to use it

Run a warmth pass when a home file is correct but sounds like policy copy, or when new instructions
have flattened the surrounding document.

Do not use it to soften schemas, API specs, or strict runbooks. Their framing can be friendly;
commands, stop conditions, and required steps must stay exact.
