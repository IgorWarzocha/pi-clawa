import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { BackgroundMemory } from './background-memory.js'
import { enqueue, listJobs, retryJob } from './consolidation/index.js'

const WHITESPACE = /\s+/

interface CommandOptions {
  getAccess: (ctx: ExtensionContext) => { rootHouse: string; agentName: string }
  background: BackgroundMemory
}

function reply(pi: ExtensionAPI, content: string): void {
  pi.sendMessage(
    { customType: 'clawa-memory-status', content, display: true },
    { triggerTurn: false },
  )
}

async function rememberAndClose(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  options: CommandOptions,
): Promise<void> {
  await ctx.waitForIdle()
  const access = options.getAccess(ctx)
  const sessionFile = ctx.sessionManager.getSessionFile()
  const leafId = ctx.sessionManager.getLeafId()
  const model = ctx.model
  if (!(sessionFile && leafId && model))
    throw new Error('There is no saved conversation and model to remember yet')
  const id = enqueue(access.rootHouse, {
    sessionFile,
    leafId,
    chatId: ctx.sessionManager.getSessionId(),
    agentName: access.agentName,
    cwd: ctx.cwd,
    model: { provider: model.provider, id: model.id },
    ...(ctx.thinkingLevel ? { thinkingLevel: ctx.thinkingLevel } : {}),
  })
  // Freeze durably before switching. A cancelled switch still leaves a valid frozen job.
  const result = await ctx.newSession()
  reply(
    pi,
    `Memory pass queued: ${id}.${result.cancelled ? ' The session switch was cancelled; this conversation is still open.' : ' A fresh conversation is ready.'}`,
  )
  options.background.kick()
}

export function registerMemoryCommand(pi: ExtensionAPI, options: CommandOptions): void {
  pi.registerCommand('memory', {
    description: 'Memory jobs: status, remember (save and start fresh), retry <id>',
    handler: async (args, ctx) => {
      const [action = 'status', id, extra] = args.trim().split(WHITESPACE).filter(Boolean)
      if (action === 'remember' && !id) {
        await rememberAndClose(pi, ctx, options)
        return
      }
      const { rootHouse } = options.getAccess(ctx)
      if (action === 'retry' && id && !extra) {
        retryJob(rootHouse, id)
        reply(pi, `Memory pass queued again: ${id}.`)
        options.background.kick()
        return
      }
      if (action !== 'status' || id)
        throw new Error('Use /memory, /memory remember, or /memory retry <job-id>')
      const jobs = listJobs(rootHouse)
      reply(
        pi,
        jobs.length === 0
          ? 'No memory passes queued yet. /memory remember carries this conversation forward and starts a fresh one.'
          : jobs
              .slice(-20)
              .map(
                (job) =>
                  `${job.id} — ${job.agentName}: ${job.status}${job.error ? ` — ${job.error}` : ''}`,
              )
              .join('\n'),
      )
    },
  })
}
