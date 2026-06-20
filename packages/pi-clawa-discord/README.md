# @howaboua/pi-clawa-discord

Discord adapter for `@howaboua/pi-claw`.

Setup guide: `DISCORD-BOT-SETUP.md`.

For git-repo installs, add the core package from git and this adapter from a local checkout path:

```json
{
  "packages": [
    "git:github.com/howaboua/pi-claw",
    "/absolute/path/to/pi-claw/packages/pi-clawa-discord"
  ],
  "sessionDir": ".pi/sessions"
}
```

Then start Pi and run `/discord`.

## Attribution

This adapter carries forward earlier Discord gateway groundwork by **patchfx**. It has since been heavily reshaped around Clawa/Clawas, but the original MIT license and credit stay with the package.

The gateway architecture also keeps a small nod to NanoClaw for the Discord → queue → agent → Discord relay pattern.
