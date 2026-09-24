import type {
  AgentActivityOutcome,
  ContextUsage,
  CustomMessageEntryDraft,
  ExtensionAPI,
} from '@earendil-works/pi-coding-agent'
import type { ClawaMemoryPassConfig } from './config.js'

const MEMORY_PASS_MESSAGE_TYPE = 'clawa-memory-pass'

const MEMORY_PASS_PROMPT = `Hey Clawa — this session is getting rather full. Before Pi folds it down, take a little memory pass.

Use recall with no query and limit 5 to revisit your latest shared memories. Then look back over what genuinely mattered in this run and use remember for only the pieces worth carrying forward.

Prefer updating an existing memory by its id when the truth has grown or changed. Don't repeat what is already there, and skip routine completions, temporary tasks, and things the living home docs already own. Add up to five new memories, but fewer—or none—is completely fine.

Once they're tucked away, carry on normally. Pi will handle the actual compaction.`

export function shouldRequestMemoryPass(
  config: ClawaMemoryPassConfig,
  usage: ContextUsage | undefined,
  armed: boolean,
): boolean {
  if (!(config.enabled && armed) || usage?.tokens === null || usage === undefined) return false
  if (!Number.isFinite(usage.contextWindow) || usage.contextWindow <= 0) return false
  return usage.tokens >= Math.floor((usage.contextWindow * config.triggerPercent) / 100)
}

export class MemoryPass {
  private armed = true

  rearm(): void {
    this.armed = true
  }

  request(
    config: ClawaMemoryPassConfig,
    usage: ContextUsage | undefined,
    outcome: AgentActivityOutcome,
  ): CustomMessageEntryDraft | undefined {
    if (outcome !== 'completed' || !shouldRequestMemoryPass(config, usage, this.armed)) return
    this.armed = false
    return {
      type: 'custom_message',
      customType: MEMORY_PASS_MESSAGE_TYPE,
      content: MEMORY_PASS_PROMPT,
      display: false,
      details: {
        triggerPercent: config.triggerPercent,
        tokens: usage?.tokens,
        contextWindow: usage?.contextWindow,
      },
    }
  }
}

export function registerMemoryPass(pi: ExtensionAPI, getConfig: () => ClawaMemoryPassConfig): void {
  const memoryPass = new MemoryPass()
  const rearm = () => memoryPass.rearm()
  pi.on('session_start', rearm)
  pi.on('session_compact', rearm)

  pi.on('agent_before_settle', (event, ctx) => {
    const draft = memoryPass.request(getConfig(), ctx.getContextUsage(), event.outcome)
    if (!draft) return
    // Preserve earlier handlers' drafts. Pi persists the pass before continuing the run.
    return { entries: [...event.entries, draft], continue: true }
  })
}
