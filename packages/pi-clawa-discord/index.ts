import { fileURLToPath } from 'node:url'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { DiscordActivityMonitor } from './src/extension/activity-monitor.js'
import { registerDiscordCodeModeTools } from './src/extension/code-mode.js'
import { registerDiscordHistoryTool } from './src/extension/history-tool.js'
import { runDiscordSetup } from './src/extension/setup.js'
import { registerDiscordTool } from './src/extension/tool.js'
import { DiscordSession } from './src/session.js'

/** @public Pi extension: each home connects its own bot to its visible session. */
export default async function clawDiscord(pi: ExtensionAPI): Promise<void> {
  const entryPath = fileURLToPath(import.meta.url)
  process.env['PI_CLAW_DISCORD_EXTENSION_PATH'] = entryPath
  const monitor = new DiscordActivityMonitor()
  let session: DiscordSession | undefined
  let transition = Promise.resolve()
  let disposed = false

  const replaceSession = (context: ExtensionContext): Promise<void> => {
    // Validate the replacement before stopping a working connection.
    transition = transition
      .catch(() => {})
      .then(async () => {
        if (disposed) return
        const next = new DiscordSession(pi, context, monitor)
        await session?.stop()
        session = next
        await next.start()
      })
    return transition
  }
  const stopSession = (): Promise<void> => {
    transition = transition
      .catch(() => {})
      .then(async () => {
        await session?.stop()
      })
    return transition
  }

  const send = registerDiscordTool(pi, () => session?.output)
  const history = registerDiscordHistoryTool(pi)
  await registerDiscordCodeModeTools(pi, send, history)

  pi.registerCommand('discord', {
    description: 'Connect this Clawa to its own Discord bot',
    handler: async (_args, context) => {
      if (!session) await replaceSession(context)
      const current = session
      if (!current) return
      await runDiscordSetup(context, {
        config: current.config,
        chatEnabled: current.chatEnabled,
        describeStatus: () => session?.describeStatus() ?? 'Discord stopped',
        guide: () =>
          pi.sendUserMessage(
            'Help me connect this Clawa home to its own Discord bot. Guide me through creating a separate application in the Discord Developer Portal, enabling Message Content Intent, inviting that bot with View Channels, Send Messages, Read Message History, Attach Files and Add Reactions, and pasting its token into /discord in this tab. Keep the token private and do not reuse another Clawa bot token.',
          ),
        setChatEnabled: (enabled) => current.setChatEnabled(enabled),
        restart: () => replaceSession(context),
        stop: stopSession,
      })
    },
  })

  pi.on('session_start', async (_event, context) => {
    await replaceSession(context)
  })
  pi.on('before_agent_start', (event, context) => {
    const prompt = session?.getDiscordSystemPrompt(context)
    return prompt ? { systemPrompt: `${event.systemPrompt}\n\n${prompt}` } : undefined
  })
  pi.on('message_end', (event) => session?.capture(event.message))
  pi.on('agent_settled', async (_event, context) => {
    const current = session
    if (!current) return
    const changed = current.hasConfigChanged()
    if (changed) current.setUiBlocked(true, context)
    await current.settle(context)
    if (changed && current === session) await replaceSession(context)
  })
  pi.on('ui_prompt_start', (_event, context) => session?.setUiBlocked(true, context))
  pi.on('ui_prompt_end', (_event, context) => session?.setUiBlocked(false, context))
  pi.on('model_select', (_event, context) => session?.setUiBlocked(false, context))
  pi.on('session_shutdown', async () => {
    disposed = true
    try {
      await stopSession()
    } finally {
      session = undefined
      monitor.dispose()
      if (process.env['PI_CLAW_DISCORD_EXTENSION_PATH'] === entryPath) {
        delete process.env['PI_CLAW_DISCORD_EXTENSION_PATH']
      }
    }
  })
}
