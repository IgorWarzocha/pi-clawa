---
title: Discord adapter
description: Connect a dedicated Clawa to Discord's routed message lane.
section: Operate
order: 70
---

The Discord adapter is an optional package under `packages/pi-clawa-discord`. It is substantial but
still **work in progress**. Its own README and setup guide own details that are still moving.

## Shape

The adapter uses a dedicated Discord Clawa rather than sending public room traffic straight into the
main session. On main session startup it ensures the worker and its template exist. When a bot token
is configured, it starts or adopts a separate gateway process, with logs and delivery state under
`.pi/clawa-discord/`.

The gateway receives Discord events, stores bounded delivery/context state in SQLite, and queues a
follow-up to the mapped worker with recent channel context and message handles. The worker decides
whether and where a response belongs.

## Explicit final routing

Normal final text from the Discord worker is **not delivered**. Public output must use known route
blocks:

```text
[#known-channel]: public room reply
[dm]: private reply to the human
[main_clawa]: private handoff to the main Clawa
[quiet]
```

The worker must not invent channel tags. `[quiet]` is a real delivery directive: no public message is
emitted for that final response. Reactions use a source handle such as `[react m1: 👍]`.

This strictness makes accidental private-status leakage less likely and keeps public speech an
intentional act.

## Rich operations

The `message_discord` tool covers explicit sends that route blocks cannot express cleanly:

- local images and files;
- rich Components V2 cards;
- buttons, selects, and modals;
- polls and reactions;
- messages outside the current turn's final route.

The adapter also handles reply-parent context, attachments, edits and deletions, and Discord's
**Apps → Ask Clawa** contextual action.

## Process ownership

The gateway uses a lock so another main session can adopt a live process rather than starting a
duplicate. An adopted gateway is not killed when the adopting Pi session shuts down. Gateway logs
live at `.pi/clawa-discord/gateway.log`.
