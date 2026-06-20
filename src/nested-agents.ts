import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import {
  appendAgentsContext,
  collectBranchContext,
  mergePersistedContextDetails,
} from './nested-agents/persisted-context.js'
import { NestedAgentsSession } from './nested-agents/session.js'

function notifyLoaded(ctx: ExtensionContext, loadedNow: string[]): void {
  if (loadedNow.length === 0 || !ctx.hasUI) return
  const label =
    loadedNow.length === 1
      ? `Loaded nested AGENTS.md context: ${loadedNow[0]}`
      : `Loaded nested AGENTS.md context (${loadedNow.length} files)`
  ctx.ui.notify(label, 'info')
}

function notifyFailed(
  ctx: ExtensionContext,
  failedFiles: Array<{ agentsPath: string; error: Error }>,
): void {
  if (!ctx.hasUI) return
  for (const failed of failedFiles) {
    ctx.ui.notify(`Failed to load ${failed.agentsPath}: ${failed.error.message}`, 'warning')
  }
}

export function registerNestedAgentsAutoload(pi: ExtensionAPI): void {
  const session = new NestedAgentsSession()

  const handleSessionChange = (_event: unknown, ctx: ExtensionContext): void => {
    session.reset(ctx.cwd)
  }

  pi.on('session_start', handleSessionChange)
  pi.on('session_tree', handleSessionChange)

  pi.on('tool_result', async (event, ctx) => {
    if (event.isError) return undefined
    session.ensure(ctx.cwd)

    const targets = session.targetsForEvent(event)
    if (targets.length === 0) return undefined

    const branchContext = collectBranchContext(ctx, session.currentCwd, session.ignoredAgents)
    session.mergeRuntimeFromBranch(branchContext)

    const agentFiles = session.agentsForTargets(targets)
    if (agentFiles.length === 0) return undefined

    const result = await session.readAppendixFiles(agentFiles, branchContext, session.tick())
    notifyFailed(ctx, result.failedFiles)
    notifyLoaded(ctx, result.loadedNow)

    if (result.persistedFiles.length === 0 && result.appendixFiles.length === 0) return undefined
    const details =
      result.persistedFiles.length > 0
        ? mergePersistedContextDetails(event.details, { files: result.persistedFiles })
        : event.details
    return { content: appendAgentsContext(event.content, result.appendixFiles), details }
  })
}
