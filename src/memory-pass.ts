import type { ContextUsage, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { ClawaMemoryPassConfig } from './config.js'

const MEMORY_PASS_MESSAGE_TYPE = 'clawa-memory-pass'

const MEMORY_PASS_PROMPT = `Hey Clawa — this session is getting rather full. Before Pi folds it down, take a little memory pass.

Use recall with no query and limit 5 to revisit your latest shared memories. Then look back over what genuinely mattered in this run and use remember for only the pieces worth carrying forward.

Prefer updating an existing memory by its id when the truth has grown or changed. Don't repeat what is already there, and skip routine completions, temporary tasks, and things the living home docs already own. Add up to five new memories, but fewer—or none—is completely fine.

Once they're tucked away, carry on normally. Pi will handle the actual compaction.`

export type MemoryPassState = {
  claim: () => boolean
  isArmed: () => boolean
  rearm: () => void
}

function createMemoryPassState(): MemoryPassState {
  let armed = true
  return {
    claim: () => {
      if (!armed) return false
      armed = false
      return true
    },
    isArmed: () => armed,
    rearm: () => {
      armed = true
    },
  }
}

export function shouldRequestMemoryPass(
  config: ClawaMemoryPassConfig,
  usage: ContextUsage | undefined,
  armed: boolean,
): boolean {
  if (!(config.enabled && armed) || usage?.tokens === null || usage === undefined) return false
  if (!Number.isFinite(usage.contextWindow) || usage.contextWindow <= 0) return false
  return usage.tokens >= Math.floor((usage.contextWindow * config.triggerPercent) / 100)
}

function notifyFailure(ctx: ExtensionContext, error: unknown): void {
  if (!ctx.hasUI) return
  const message = error instanceof Error ? error.message : String(error)
  ctx.ui.notify(`Clawa memory pass could not start: ${message}`, 'warning')
}

export function registerMemoryPass(
  pi: ExtensionAPI,
  getConfig: () => ClawaMemoryPassConfig,
  state: MemoryPassState = createMemoryPassState(),
): MemoryPassState {
  const rearm = async () => state.rearm()
  pi.on('session_start', rearm)
  pi.on('session_compact', rearm)

  pi.on('agent_settled', async (_event, ctx) => {
    const usage = ctx.getContextUsage()
    const config = getConfig()
    if (!(shouldRequestMemoryPass(config, usage, state.isArmed()) && state.claim())) return

    try {
      pi.sendMessage(
        {
          customType: MEMORY_PASS_MESSAGE_TYPE,
          content: MEMORY_PASS_PROMPT,
          display: false,
          details: {
            triggerPercent: config.triggerPercent,
            tokens: usage?.tokens,
            contextWindow: usage?.contextWindow,
          },
        },
        { triggerTurn: true, deliverAs: 'followUp' },
      )
    } catch (error) {
      state.rearm()
      notifyFailure(ctx, error)
    }
  })

  return state
}
