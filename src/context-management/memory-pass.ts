import type {
  AgentActivityOutcome,
  ContextUsage,
  CustomMessageEntryDraft,
  SessionEntry,
} from '@earendil-works/pi-coding-agent'
import type { ClawaMemoryPassConfig } from '../config.js'

const MEMORY_PASS_MESSAGE_TYPE = 'clawa-memory-pass'

const MEMORY_PASS_PROMPT = `This context is getting full. Take a quiet continuity pass before continuing.

Save the active request, decisions, exact paths and history IDs, progress, deferred threads, and next actions in chat-local notes. These are your working checkpoint, not shared long-term memory.

If the conversation taught you something durable, use history search with scope:"memory" or notes list_files_by_prefix with scope:"memory" before changing shared memory. Update its existing owner rather than duplicating it. Keep identity, human context, tools, relationships, and curiosity in their living home documents. Do not copy credentials, routine completions, or tool output into memory. Saving no durable memory is completely fine.`

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

  restore(branch: readonly SessionEntry[]): void {
    this.rearm()
    for (const entry of branch) {
      if (
        entry.type === 'compaction' ||
        (entry.type === 'custom' && entry.customType === 'clawa-context-window')
      )
        this.rearm()
      if (entry.type === 'custom_message' && entry.customType === MEMORY_PASS_MESSAGE_TYPE)
        this.armed = false
    }
  }

  request(
    config: ClawaMemoryPassConfig,
    usage: ContextUsage | undefined,
    outcome: AgentActivityOutcome,
    mode: 'local' | 'pi' = 'local',
  ): CustomMessageEntryDraft | undefined {
    if (outcome !== 'completed' || !shouldRequestMemoryPass(config, usage, this.armed)) return
    this.armed = false
    return {
      type: 'custom_message',
      customType: MEMORY_PASS_MESSAGE_TYPE,
      content: `${MEMORY_PASS_PROMPT}\n\n${mode === 'local' ? 'Then call new_context. In the fresh window read your checkpoint and continue the work.' : 'Then carry on normally. Pi owns compaction in this home.'}`,
      display: false,
      details: {
        triggerPercent: config.triggerPercent,
        tokens: usage?.tokens,
        contextWindow: usage?.contextWindow,
      },
    }
  }
}
