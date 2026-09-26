import { join, resolve } from 'node:path'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { findRepoRoot, loadClawEnvironmentConfig } from '../config.js'
import type { ClawaRuntimeState } from '../extension/runtime-state.js'
import { BackgroundMemory } from './background-memory.js'
import { registerMemoryCommand } from './command.js'
import { migrateMemory } from './migration.js'
import { type ContextAccess, indexCurrentChat, registerContextTools } from './tools.js'
import { registerContextWindows } from './windows.js'

function houseRoot(cwd: string): string {
  return resolve(process.env['PI_CLAW_PROJECT_ROOT']?.trim() || findRepoRoot(cwd))
}

function contextAccess(ctx: ExtensionContext): ContextAccess {
  const rootHouse = houseRoot(ctx.cwd)
  const config = loadClawEnvironmentConfig(rootHouse).config
  const homes = [
    { cwd: rootHouse, agentName: 'main' },
    ...config.clawas.workers.map((worker) => {
      const cwd = resolve(rootHouse, worker.cwd)
      return { cwd, agentName: worker.id, sessionDir: join(cwd, '.pi', 'sessions') }
    }),
  ]
  const agentName =
    process.env['PI_CLAWAS_WORKER_ID']?.trim() ||
    homes.find((home) => home.cwd === resolve(ctx.cwd))?.agentName ||
    'main'
  return { rootHouse, agentName, homes }
}

export function registerContextManagement(pi: ExtensionAPI, runtime: ClawaRuntimeState): void {
  const background = new BackgroundMemory(pi)
  let state:
    | { kind: 'unavailable' }
    | { kind: 'ready'; rootHouse: string }
    | { kind: 'failed'; error: unknown } = { kind: 'unavailable' }
  const readyAccess = (ctx: ExtensionContext): ContextAccess => {
    if (state.kind === 'failed')
      throw new Error(
        'Local memory migration or startup failed; fix the reported error and reload',
        { cause: state.error },
      )
    if (state.kind !== 'ready' || state.rootHouse !== houseRoot(ctx.cwd))
      throw new Error('Clawa home bootstrap must finish before using local memory')
    return contextAccess(ctx)
  }

  // Bootstrap runs earlier. Migration must finish before tools, catalog access, or jobs can write.
  pi.on('session_start', async (_event, ctx) => {
    if (!runtime.ensureBootstrapped(ctx.cwd)) {
      state = { kind: 'unavailable' }
      await background.stop()
      return
    }
    const access = contextAccess(ctx)
    try {
      if (state.kind !== 'ready' || state.rootHouse !== access.rootHouse) {
        state = { kind: 'unavailable' }
        await background.stop()
        const result = await migrateMemory(access.rootHouse, new AbortController().signal)
        if (result.vaultFiles > 0 || result.legacyRows > 0) {
          pi.sendMessage(
            {
              customType: 'clawa-memory-migration',
              content: `Memory is now shared Markdown at ${access.rootHouse}/memory/. Moved ${result.vaultFiles} vault files and imported ${result.legacyRows} legacy records. Existing home prose is not rewritten; use memory/ rather than vault/ from here. The old database, if present, is retired and retained unchanged.`,
              display: true,
            },
            { triggerTurn: false },
          )
        }
      }
      await indexCurrentChat(access, ctx)
      await background.attach(access.rootHouse, ctx)
      state = { kind: 'ready', rootHouse: access.rootHouse }
    } catch (error) {
      state = { kind: 'failed', error }
      await background.stop()
      throw error
    }
  })

  registerContextTools(pi, (ctx) => readyAccess(ctx))
  registerContextWindows(pi, {
    getDefaults: (ctx) => loadClawEnvironmentConfig(houseRoot(ctx.cwd)).config.clawa,
    getAccess: readyAccess,
    isReady: () => state.kind === 'ready',
    runtime,
  })
  registerMemoryCommand(pi, { getAccess: readyAccess, background })
  pi.on('agent_settled', async (_event, ctx) => {
    if (state.kind !== 'ready') return
    await indexCurrentChat(contextAccess(ctx), ctx)
    background.kick()
  })
  pi.on('session_shutdown', () => background.stop())
}
