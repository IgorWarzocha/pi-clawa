# @howaboua/pi-clawa-discord

Discord adapter for `@howaboua/pi-clawa`.

Status: WIP. The adapter works, but setup polish, lifecycle behavior, multi-channel taste, and autonomy policy are still being shaped.

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

Config lives under `.pi/clawa-discord/`:

- `config.env` stores the token and gateway settings.
- `routes.jsonc` maps names like `dm` and `#howaclawa` to Clawa workers.
- `channels.json` is a gateway-written snapshot of Discord channels it has seen.

Clawas should edit route names, not Discord ids. The gateway resolves names to ids.

## Attribution

This adapter started from **Crokily/pi-discord-gateway** / **Piscord**. The upstream MIT license names **patchfx** as copyright holder; both the source repo and license credit stay with this package.

It has since been heavily reshaped around Clawa/Clawas.

The gateway architecture also keeps a small nod to NanoClaw for the Discord → queue → agent → Discord relay pattern.
