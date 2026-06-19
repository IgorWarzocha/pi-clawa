# Discord bot setup

These are the minimum steps for connecting Clawa to Discord.

## 1. Create the Discord application

1. Open https://discord.com/developers/applications
2. Click **New Application**.
3. Give it a clear name.
4. Open **Bot** in the left sidebar.
5. Click **Add Bot** if there is no bot yet.

## 2. Enable required bot access

In the bot settings:

1. Find **Privileged Gateway Intents**.
2. Enable **Message Content Intent**.
3. Save changes.

## 3. Copy the bot token

In the same **Bot** page:

1. Click **Reset Token** or **Copy Token**.
2. Keep the token private.
3. Paste it into the Clawa `/discord` setup screen.

## 4. Invite the bot to your server

In the Discord developer portal:

1. Open **OAuth2** → **URL Generator**.
2. Under **Scopes**, select `bot`.
3. Under **Bot Permissions**, select:
   - View Channels
   - Send Messages
   - Read Message History
   - Attach Files
4. Open the generated URL.
5. Choose your server and authorize the bot.

## 5. Get the Discord channel id

In Discord:

1. Enable Developer Mode if needed:
   - User Settings → Advanced → Developer Mode
2. Right-click the channel Clawa should use.
3. Click **Copy Channel ID**.
4. Paste that id into the Clawa `/discord` setup screen.

## 6. Start the gateway

Back in `/discord`:

1. Save the bot token.
2. Save the channel id.
3. Choose **start gateway**.

The setup writes project-local config to `.pi/claw-discord/config.env`.
