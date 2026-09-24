# Discord bot setup

Each Clawa home that connects to Discord needs its own application and token. Never reuse a bot
token across running homes. The adapter is work in progress; live Discord compatibility is not yet
verified.

1. Open https://discord.com/developers/applications and create an application. Open **Bot** and add
   a bot if needed. Enable **Message Content Intent** under **Privileged Gateway Intents** and save.
2. On the **Bot** page, copy or reset the token. Keep it private. Do not paste it into `CLAW.md`,
   chats, commits, or another home's configuration.
3. Under **OAuth2** → **URL Generator**, select the `bot` and `applications.commands` scopes. Grant
   **View Channels**, **Send Messages**, **Read Message History**, **Attach Files**, and **Add Reactions**. Open the generated invite URL
   and authorize the bot in the server you choose.
4. Load `@howaboua/pi-clawa-discord` alongside Clawa, open Pi in the intended home, and run
   `/discord`. Set this home's token and connect. An empty token leaves it disconnected.
5. Send the bot a DM, mention it in a channel it can view, or reply to one of its messages. Watch
   the turn arrive in the same Pi tab. A `[m1]` final block replies to the numbered message; a
   `[c]` block posts to the channel. Unmarked final text is private to Pi.

Use `/discord` to change incoming channel policy, allowed or excluded channel IDs, allowed user
IDs, home-specific aliases, a default DM recipient, chat intake, and ambient wake. The defaults
are mention-based intake, no aliases, chat enabled, and ambient wake off. A worker tab can own its
own separate bot without becoming a designated `discord-clawa` worker.

The token and settings live in this home's `.pi/clawa-discord/bot.env`, created with mode `0600`.
The adapter does not read token settings from the parent home or the process environment. Disconnect
or close the owning tab to stop its bot. For migration from the old gateway, follow the
[Discord guide](https://igorwarzocha.github.io/pi-clawa/docs/operate/discord/#migrating-from-the-old-gateway).
