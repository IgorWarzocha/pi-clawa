import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { getWorkerSessionName } from '../clawas/worker-identity.js'
import { findRepoRoot, resolveClawaDefaults, resolveClawasControlSocketRoot } from '../config.js'
import { IS_CLAWAS_WORKER } from './constants.js'
import { INITIAL_BOOTSTRAP_PROMPT } from './onboarding.js'

const BOOTSTRAP_MESSAGE_TYPE = 'clawa-bootstrap'

export function syncClawaEnvironment(cwd: string): void {
  const repoRoot = findRepoRoot(cwd)
  const clawaDefaults = resolveClawaDefaults(cwd)
  process.env.PI_CLAW_PROJECT_ROOT = repoRoot
  process.env.PI_CLAWAS_CONTROL_SOCKET_ROOT = resolveClawasControlSocketRoot(repoRoot)
  process.env.PI_CLAWAS_CONTROL_SOCKET_DIR = clawaDefaults.controlSocketDir
}

export function getWorkerAlias(): string | undefined {
  if (!IS_CLAWAS_WORKER) return 'main-claw'
  return process.env.PI_CLAWAS_SOCKET_ALIAS?.trim() || undefined
}

export function sendInitialBootstrapPrompt(pi: ExtensionAPI, ctx: ExtensionContext): void {
  setTimeout(() => {
    const message = {
      customType: BOOTSTRAP_MESSAGE_TYPE,
      content: INITIAL_BOOTSTRAP_PROMPT,
      display: false,
    }
    if (ctx.isIdle()) {
      pi.sendMessage(message, { triggerTurn: true })
      return
    }
    pi.sendMessage(message, { triggerTurn: true, deliverAs: 'followUp' })
  }, 0)
}

export function maybeSetWorkerSessionName(pi: ExtensionAPI, ctx: ExtensionContext): void {
  if (!IS_CLAWAS_WORKER) return

  const workerId = process.env.PI_CLAWAS_WORKER_ID?.trim()
  const workerTitle = process.env.PI_CLAWAS_WORKER_TITLE?.trim() || workerId
  if (!(workerId && workerTitle)) return

  pi.setSessionName(
    getWorkerSessionName(
      {
        id: workerId,
        title: workerTitle,
        cwd: ctx.cwd,
        enabled: true,
        autostart: false,
      },
      resolveClawaDefaults(ctx.cwd),
    ),
  )
}
