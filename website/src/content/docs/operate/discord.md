---
title: Discord adapter
description: Connect a Clawa home to its own Discord bot.
section: Operate
order: 70
---

The optional package at `packages/pi-clawa-discord` connects a bot inside the Pi tab for a Clawa
home. It is **work in progress**. Live Discord compatibility has not yet been verified.

## Connect a home

Follow the [bot setup guide](https://github.com/IgorWarzocha/pi-clawa/blob/master/packages/pi-clawa-discord/DISCORD-BOT-SETUP.md) to
create an application and invite its bot. Load the adapter beside Clawa in that home's Pi settings,
open Pi there, run `/discord`, enter its token, and connect. DM the bot or mention it in an allowed
channel. The message and Clawa's ensuing turn appear in the **same tab**, not in a dedicated
Discord worker. A specialist can connect its own separate application from its own tab. Keep bot
tokens distinct; an OS-backed lease rejects a token already in use by another home.

By default, DMs, mentions, and replies to the bot wake the home. `/discord` also controls incoming
channel policy, allowed and excluded channel IDs, allowed users, optional trigger aliases, a default
DM recipient, and whether chat intake is armed. Aliases start empty and belong only to that home.
Bot-authored messages are ignored. Ambient wakes are opt-in: after a per-channel jitter of 8 to 16
messages, Clawa sees one batch and can decide not to speak. Pausing chat intake does not disconnect
the bot.

## Send deliberately

An incoming turn shows numbered message handles. A final block like `[m1] Thanks for the note`
replies to that exact message. `[c] I'll look into it` posts in the current channel without a
reply target. Several blocks can be delivered in order. Unmarked assistant final text stays in Pi.
Use `discord_send` for rich delivery such as files, reactions, cards, buttons, selects, and polls.
Use `discord_history` to search local Discord history. Core `recall` and `remember` are unchanged.

## Local state and lifecycle

The home owns `.pi/clawa-discord/bot.env`, created with mode `0600`. An empty token keeps Discord
off. No token or configuration is inherited from the process or parent home. The same directory
keeps searchable history in `gateway.db`, archive retries in `archive-pending.json`, cached assets
in `assets/`, and a channel snapshot in `channels.json`. Keep the whole directory private.

Connection follows Pi start, resume, reload, and shutdown. Config edits restart the connection at
settlement. Closing a worker tab disconnects that worker's bot; quitting main does not stop bots in
other open worker tabs. Pending turns and rich action tokens are in memory, so disconnect or reload
drops them, but archived history remains. The old synthetic join and leave worker turns are gone.

## Migrating from the old gateway

**Before updating**, use the old `/discord` to stop the shared gateway. Then update the checkout,
open each home that should have a bot, and use its new `/discord` to configure and reconnect it.
`config.env` and `routes.jsonc` are no longer read. Tokens are not moved automatically. The old
Discord worker home, Pi session history, and `gateway.db` are not deleted. Do not reuse the same
token in multiple homes.
