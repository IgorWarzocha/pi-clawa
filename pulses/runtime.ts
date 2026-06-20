import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { sendClawasSessionMessage } from '../clawas/comms/client.js'
import type { ClawasRuntime } from '../clawas/runtime.js'
import type { WorkerState } from '../clawas/types.js'
import { getWorkerSocketAlias } from '../clawas/worker-identity.js'
import { discoverPulseDefinitions, type PulseDefinition } from './definitions.js'
import { buildPulseInstruction, CLAWA_PULSE_MESSAGE_TYPE, pulseDetails } from './message.js'
import { isPulseDue, pulseDueKey } from './schedule.js'
import { type PulseSchedulerState, readPulseState, writePulseState } from './state.js'

const PULSE_TICK_MS = 30_000

type PulseRunMode = 'scheduled' | 'forced'

function isWorkerBusy(worker: WorkerState | undefined): boolean {
  return Boolean(
    worker?.manualSession || worker?.status === 'starting' || worker?.status === 'streaming',
  )
}

function findWorker(runtime: ClawasRuntime, workerId: string): WorkerState | undefined {
  return runtime.getState()?.workers.find((worker) => worker.definition.id === workerId)
}

export class PulseRuntime {
  private context: ExtensionContext | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private readonly pi: ExtensionAPI
  private readonly clawasRuntime: ClawasRuntime

  constructor(pi: ExtensionAPI, clawasRuntime: ClawasRuntime) {
    this.pi = pi
    this.clawasRuntime = clawasRuntime
  }

  attach(context: ExtensionContext): void {
    this.context = context
    this.ensureStarted()
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.context = null
  }

  async list(): Promise<PulseDefinition[]> {
    if (!this.context) return []
    return await discoverPulseDefinitions(this.context.cwd)
  }

  async runNow(target: string): Promise<PulseDefinition> {
    const ctx = this.requireContext()
    const pulses = await discoverPulseDefinitions(ctx.cwd)
    const pulse = resolvePulseTarget(pulses, target)
    if (!pulse) throw new Error(`Unknown pulse: ${target}`)
    await this.dispatchPulse(pulse, 'forced')
    return pulse
  }

  async scanAndRunDue(nowMs = Date.now()): Promise<void> {
    if (this.running) return
    const ctx = this.context
    if (!ctx) return

    this.running = true
    try {
      const pulses = await discoverPulseDefinitions(ctx.cwd)
      const state = await readPulseState(ctx.cwd)
      let changed = seedNewPulses(state, pulses, nowMs)

      for (const pulse of pulses) {
        const entry = state.pulses[pulse.key]
        const due = isPulseDue({
          schedule: pulse.schedule,
          nowMs,
          firstSeenAt: entry?.firstSeenAt,
          lastRunAt: entry?.lastRunAt,
          lastDueKey: entry?.lastDueKey,
        })
        if (!due.due) continue
        if (!(await this.canRunPulse(pulse))) continue
        await this.dispatchPulse(pulse, 'scheduled')
        state.pulses[pulse.key] = {
          ...entry,
          firstSeenAt: entry?.firstSeenAt ?? nowMs,
          lastRunAt: nowMs,
          lastDueKey: due.dueKey ?? entry?.lastDueKey,
        }
        changed = true
      }

      if (changed) await writePulseState(ctx.cwd, state)
    } finally {
      this.running = false
    }
  }

  private ensureStarted(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.scanAndRunDue().catch((error) => this.notifyError(error))
    }, PULSE_TICK_MS)
    this.timer.unref?.()
  }

  private async canRunPulse(pulse: PulseDefinition): Promise<boolean> {
    const ctx = this.requireContext()
    if (pulse.ownerId === 'main') return ctx.isIdle()
    await this.clawasRuntime.refreshFromConfig()
    return !isWorkerBusy(findWorker(this.clawasRuntime, pulse.ownerId))
  }

  private async dispatchPulse(pulse: PulseDefinition, mode: PulseRunMode): Promise<void> {
    const forced = mode === 'forced'
    const instruction = buildPulseInstruction(pulse, forced)
    if (pulse.ownerId === 'main') {
      this.sendMainPulse(pulse, instruction, forced)
      return
    }
    await this.sendWorkerPulse(pulse, instruction)
  }

  private sendMainPulse(pulse: PulseDefinition, instruction: string, forced: boolean): void {
    const ctx = this.requireContext()
    this.pi.sendMessage(
      {
        customType: CLAWA_PULSE_MESSAGE_TYPE,
        content: instruction,
        display: true,
        details: pulseDetails(pulse, forced),
      },
      ctx.isIdle() ? { triggerTurn: true } : { triggerTurn: true, deliverAs: 'followUp' },
    )
  }

  private async sendWorkerPulse(pulse: PulseDefinition, instruction: string): Promise<void> {
    await this.clawasRuntime.refreshFromConfig()
    const definition = this.clawasRuntime.getWorkerDefinition(pulse.ownerId)
    await this.clawasRuntime.ensureWorkerRunning(pulse.ownerId)
    await sendClawasSessionMessage(getWorkerSocketAlias(definition), {
      message: instruction,
      messageType: 'session',
      mode: 'steer',
      sender: {
        workerId: 'main-claw',
        workerTitle: this.clawasRuntime.getClawaDefaults().mainClawName,
      },
      kind: 'instruction',
      intent: 'reply_requested',
      visibility: 'worker',
    })
  }

  private requireContext(): ExtensionContext {
    if (!this.context) throw new Error('Pulse runtime is not attached')
    return this.context
  }

  private notifyError(error: unknown): void {
    const ctx = this.context
    if (!ctx?.hasUI) return
    ctx.ui.notify(
      `Pulse failed: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    )
  }
}

function seedNewPulses(
  state: PulseSchedulerState,
  pulses: PulseDefinition[],
  nowMs: number,
): boolean {
  let changed = false
  const live = new Set(pulses.map((pulse) => pulse.key))
  for (const pulse of pulses) {
    if (state.pulses[pulse.key]) continue
    state.pulses[pulse.key] = {
      firstSeenAt: nowMs,
      lastDueKey: pulseDueKey(pulse.schedule, nowMs) ?? undefined,
    }
    changed = true
  }
  for (const key of Object.keys(state.pulses)) {
    if (live.has(key)) continue
    delete state.pulses[key]
    changed = true
  }
  return changed
}

function resolvePulseTarget(
  pulses: PulseDefinition[],
  target: string,
): PulseDefinition | undefined {
  const normalized = target.trim().toLowerCase()
  return (
    pulses.find((pulse) => pulse.key.toLowerCase() === normalized) ??
    pulses.find((pulse) => pulse.id.toLowerCase() === normalized) ??
    pulses.find((pulse) => pulse.title.toLowerCase() === normalized)
  )
}
