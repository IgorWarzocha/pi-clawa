import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { findRepoRoot } from '@howaboua/pi-clawa/config'
import { ensureDiscordConfig } from './src/extension/env-file.js'
import { startGateway, stopGateway } from './src/extension/gateway.js'
import { runDiscordGui } from './src/extension/gui.js'
import { registerDiscordTool } from './src/extension/tool.js'
import { ensureDiscordWorker } from './src/extension/worker.js'

export default function clawDiscord(pi: ExtensionAPI): void {
  registerDiscordTool(pi)

  if (process.env['PI_CLAWAS_ROLE'] === 'worker') return

  pi.registerCommand('discord', {
    description: 'Open Clawa Discord setup',
    handler: async (_args, ctx) => {
      const projectRoot = findRepoRoot(ctx.cwd)
      ensureDiscordConfig(projectRoot)
      await ensureDiscordWorker(projectRoot)
      await runDiscordGui(pi, ctx, projectRoot)
    },
  })

  pi.on('session_start', async (_event, ctx) => {
    const projectRoot = findRepoRoot(ctx.cwd)
    ensureDiscordConfig(projectRoot)
    await ensureDiscordWorker(projectRoot)
    await startGateway(projectRoot, ctx)
  })

  pi.on('session_shutdown', async () => {
    await stopGateway()
  })
}
