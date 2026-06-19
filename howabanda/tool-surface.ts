import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { sendHowabandaSessionMessage } from './comms/client.js'
import { getLastDeliveryMessage, getLastMailMessageTimestamp } from './comms/message-extract.js'
import { publishHowabandaDeliveryMessage } from './comms/outbound.js'
import { shouldSkipAutoMainClawStatusRelay } from './comms/report-back-helpers.js'
import { getHowabandaConfigPath, loadHowabandaConfig } from './config-loader.js'
import type { HowabandaRuntime } from './runtime.js'
import type { WorkerDefinition } from './types.js'
import { getWorkerSocketAlias } from './worker-identity.js'

async function resolveClawDefinition(cwd: string, claw: string): Promise<WorkerDefinition | null> {
  const config = await loadHowabandaConfig(cwd)
  if (!config) {
    return null
  }

  const normalized = claw.trim().toLowerCase()
  return (
    config.workers.find((entry) => entry.id.toLowerCase() === normalized) ??
    config.workers.find((entry) => entry.title.toLowerCase() === normalized) ??
    null
  )
}

function manualSessionError(title: string, bandaName: string) {
  return {
    content: [
      {
        type: 'text' as const,
        text: `${title} is in a manual session and disconnected from ${bandaName}.`,
      },
    ],
    isError: true,
  }
}

export function registerHowabandaTools(pi: ExtensionAPI, runtime: HowabandaRuntime): void {
  const configPath = getHowabandaConfigPath(process.cwd())
  if (process.env.PI_HOWABANDA_ROLE === 'worker') {
    pi.registerTool({
      name: 'message_main_claw',
      label: 'Message Howaclawa',
      description: `Private route to ${runtime.getBurrowDefaults().mainClawName}. Use it for internal-only notes, banda handoffs, and private coordination. Send at most one private status per turn.`,
      parameters: Type.Object({
        message: Type.String({
          description: `Private note for ${runtime.getBurrowDefaults().mainClawName}. This is delivered only through the private HOWABANDA lane.`,
        }),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const workerId = process.env.PI_HOWABANDA_WORKER_ID?.trim()
        const workerTitle = process.env.PI_HOWABANDA_WORKER_TITLE?.trim() || workerId || 'worker'

        try {
          if (
            shouldSkipAutoMainClawStatusRelay({
              lastDelivery: getLastDeliveryMessage(ctx),
              lastMailTimestamp: getLastMailMessageTimestamp(ctx),
            })
          ) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Private note already sent to ${runtime.getBurrowDefaults().mainClawName} for this turn.`,
                },
              ],
              details: { workerId },
            }
          }

          await sendHowabandaSessionMessage('main-claw', {
            message: params.message,
            messageType: 'report',
            sender: {
              workerId: workerId ?? 'worker',
              workerTitle,
            },
            kind: 'report',
            intent: 'handoff',
            visibility: 'private',
          })
          publishHowabandaDeliveryMessage(pi, params.message, {
            route: 'main-claw',
            workerId,
            workerTitle,
          })
          return {
            content: [
              {
                type: 'text',
                text: `Sent private note to ${runtime.getBurrowDefaults().mainClawName}.`,
              },
            ],
            details: { workerId },
          }
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: error instanceof Error ? error.message : String(error),
              },
            ],
            isError: true,
          }
        }
      },
    })

    return
  }

  pi.registerTool({
    name: 'message_banda',
    label: 'Message Banda',
    description: `Private sideband route to another HOWABANDA worker by claw name or title from ${configPath}. Use this for worker-to-worker coordination inside the burrow.`,
    parameters: Type.Object({
      claw: Type.String({
        description: `Target worker name or title from ${configPath}, like tech-a-clawa or job-a-clawa.`,
      }),
      message: Type.String({
        description:
          'The private coordination note you want to send to that worker inside HOWABANDA.',
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const definition = await resolveClawDefinition(ctx.cwd, params.claw)
      if (!definition) {
        return {
          content: [
            {
              type: 'text',
              text: `Unknown ${runtime.getBurrowDefaults().bandaName} claw: ${params.claw}`,
            },
          ],
          isError: true,
        }
      }

      if (runtime.isWorkerManual(definition.id)) {
        return manualSessionError(definition.title, runtime.getBurrowDefaults().bandaName)
      }

      try {
        await runtime.ensureWorkerRunning(definition.id)
        await sendHowabandaSessionMessage(getWorkerSocketAlias(definition), {
          message: params.message,
          messageType: 'session',
          mode: 'steer',
          sender: {
            workerId: 'main-claw',
            workerTitle: runtime.getBurrowDefaults().mainClawName,
          },
          kind: 'coordination',
          intent: 'reply_requested',
          visibility: 'worker',
        })
        return {
          content: [
            {
              type: 'text',
              text: `Sent to ${definition.title}.\n\nOutgoing note:\n${params.message}`,
            },
          ],
          details: { workerId: definition.id },
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : String(error),
            },
          ],
          isError: true,
        }
      }
    },
  })
}
