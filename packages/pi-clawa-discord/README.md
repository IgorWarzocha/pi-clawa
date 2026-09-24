# @howaboua/pi-clawa-discord

An optional Discord connection for a Clawa home. It is still work in progress; live Discord
compatibility has not yet been verified. [Create a bot](DISCORD-BOT-SETUP.md), load this package
alongside Clawa in Pi, and run `/discord` in the home you want to connect.

For a git checkout, add both package paths to that home's `.pi/settings.json`:

```json
{
  "packages": [
    "/absolute/path/to/pi-clawa",
    "/absolute/path/to/pi-clawa/packages/pi-clawa-discord"
  ]
}
```

Open Pi in that home. `/discord` lets you set the token, choose incoming channel policy, restrict
channels or users, exclude channels, set aliases and a default DM recipient, pause chat intake,
opt into ambient wakes, and connect or disconnect. The same adapter loads into worker tabs with
Clawa; a worker can use `/discord` in its own tab and connect a **different** application and token.
No dedicated Discord worker or separate gateway is created. Keep each bot token distinct. A token
already owned by another running home is rejected.

With the default mention policy, DMs, mentions, and replies to the bot wake the home. Optional
aliases are empty by default and local to each home. Ambient wakes are off by default. When enabled,
they present one batch after a per-channel jitter of 8 to 16 messages; Clawa can remain quiet. Bot
messages are ignored, so its own posts cannot wake it again.

Discord messages and agent work appear in that same Pi tab. A final block such as `[m1] Hello`
replies to that exact displayed message; `[c] Hello` posts to the current channel. Unmarked final
text stays in Pi. Use `discord_send` for files, reactions, cards, buttons, selects, polls, and other
rich delivery. `discord_history` searches local Discord history. Core `recall` and `remember` keep
their usual meaning.

Each home keeps `.pi/clawa-discord/bot.env` for its token and policy. The file is created with mode
`0600`; an empty token leaves Discord off. It does not inherit a token or config from the process or
parent home. `.pi/clawa-discord/gateway.db`, `archive-pending.json`, `assets/`, and `channels.json`
hold local history and attachment or channel state. Keep this directory private. Pending turns and
rich action tokens are in memory and are lost on disconnect or reload; archived history stays.
Closing a worker tab disconnects its bot. Quitting the main tab does not stop other worker tabs.

If you used the old shared gateway, [stop it and migrate deliberately](https://igorwarzocha.github.io/pi-clawa/docs/operate/discord/#migrating-from-the-old-gateway).

## Attribution

The earlier Piscord-based gateway credited **Crokily/pi-discord-gateway** and the MIT license's
copyright holder **patchfx**. The current in-process adapter is a Disca-derived design, adapted
for Clawa homes without copying Disca's personality, identity, or private values. See
[NOTICE](NOTICE.md).
