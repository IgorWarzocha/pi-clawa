import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { sendClawasSessionMessage } from './comms/client.js'
import { getLastDeliveryMessage, getLastMailMessageTimestamp } from './comms/message-extract.js'
import { publishClawasDeliveryMessage } from './comms/outbound.js'
import { shouldSkipAutoMainClawStatusRelay } from './comms/report-back-helpers.js'
import { loadClawasConfig } from './config-loader.js'
import type { ClawasRuntime } from './runtime.js'
import type { WorkerDefinition } from './types.js'
import { getWorkerSocketAlias } from './worker-identity.js'

async function resolveClawDefinition(cwd: string, claw: string): Promise<WorkerDefinition | null> {
  const config = await loadClawasConfig(cwd)
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

function formatClawaDeliveryReceipt(title: string): string {
  return `${title} received the note.`
}

export function registerClawasTools(pi: ExtensionAPI, runtime: ClawasRuntime): void {
  if (process.env['PI_CLAWAS_ROLE'] === 'worker') {
    pi.registerTool({
      name: 'message_main_claw',
      label: 'Message main Clawa',
      description:
        'Send an internal coordination note or handoff to the main Clawa. Send at most one status per turn.',
      promptSnippet: 'Send a note to the main Clawa',
      parameters: Type.Object({
        message: Type.String({
          description: 'Coordination note delivered through the Clawas lane',
        }),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const workerId = process.env['PI_CLAWAS_WORKER_ID']?.trim()
        const workerTitle = process.env['PI_CLAWAS_WORKER_TITLE']?.trim() || workerId || 'worker'

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
                  text: `Note already sent to ${runtime.getClawaDefaults().mainClawName} for this turn.`,
                },
              ],
              details: { workerId },
            }
          }

          await sendClawasSessionMessage('main-claw', {
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
          publishClawasDeliveryMessage(pi, params.message, {
            route: 'main-claw',
            workerId,
            workerTitle,
          })
          return {
            content: [
              {
                type: 'text',
                text: formatClawaDeliveryReceipt(runtime.getClawaDefaults().mainClawName),
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
            details: { workerId },
            isError: true,
          }
        }
      },
    })

    return
  }

  pi.registerTool({
    name: 'message_clawa',
    label: 'Message Clawa',
    description:
      'Send a coordination note to another configured Clawa by name or title. Use when that Clawa should act or reply in its own lane.',
    promptSnippet: 'Send a note to another Clawa',
    parameters: Type.Object({
      claw: Type.String({
        description: 'Configured Clawa name or title',
      }),
      message: Type.String({
        description: 'Coordination note',
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        await runtime.refreshFromConfig()
        const definition = await resolveClawDefinition(ctx.cwd, params.claw)
        if (!definition) {
          return {
            content: [
              {
                type: 'text',
                text: `Unknown ${runtime.getClawaDefaults().clawasName} claw: ${params.claw}. Use a configured Clawa name or title.`,
              },
            ],
            details: { workerId: params.claw },
            isError: true,
          }
        }

        await runtime.ensureWorkerRunning(definition.id)
        await sendClawasSessionMessage(getWorkerSocketAlias(definition), {
          message: params.message,
          messageType: 'session',
          mode: 'steer',
          sender: {
            workerId: 'main-claw',
            workerTitle: runtime.getClawaDefaults().mainClawName,
          },
          kind: 'coordination',
          intent: 'reply_requested',
          visibility: 'worker',
        })
        return {
          content: [
            {
              type: 'text',
              text: formatClawaDeliveryReceipt(definition.title),
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
          details: { workerId: params.claw },
          isError: true,
        }
      }
    },
  })
}
