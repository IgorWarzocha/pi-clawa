# @howaboua/pi-clawa-discord

Discord adapter for `@howaboua/pi-clawa`.

Status: WIP. The adapter works, but setup polish, lifecycle behavior, DMs, multi-channel support, and autonomy policy are still being shaped.

Setup guide: `DISCORD-BOT-SETUP.md`.

For git-repo installs, add the core package from git and this adapter from a local checkout path:

```json
{
  "packages": [
    "/absolute/path/to/pi-clawa",
    "/absolute/path/to/pi-clawa/packages/pi-clawa-discord"
  ],
  "sessionDir": ".pi/sessions"
}
```

Then start Pi and run `/discord`.

## Attribution

This adapter started from **Crokily/pi-discord-gateway** / **Piscord**. The upstream MIT license names **patchfx** as copyright holder; both the source repo and license credit stay with this package.

It has since been heavily reshaped around Clawa/Clawas.

The gateway architecture also keeps a small nod to NanoClaw for the Discord → queue → agent → Discord relay pattern.
