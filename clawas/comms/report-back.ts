import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { sendClawasSessionMessage } from './client.js'
import {
  getLastAssistantMessage,
  getLastDeliveryMessage,
  getLastMailMessageDetails,
  getLastMailMessageTimestamp,
} from './message-extract.js'
import {
  extractClawaReportText,
  shouldReportClawaFinalToMain,
  shouldSkipAutoMainClawStatusRelay,
} from './report-back-helpers.js'

interface ReportBackOptions {
  workerId?: string
  workerTitle?: string
  targetSessionId?: string
  agentMessages?: unknown[]
}

const lastReportByWorker = new Map<string, string>()

function textFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .filter(
      (part): part is { type: 'text'; text: string } =>
        typeof part === 'object' &&
        part !== null &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string',
    )
    .map((part) => part.text)
    .join('\n')
}

function getLastAssistantFromAgentEndMessages(
  messages: unknown[] | undefined,
): { content: string; timestamp?: number } | undefined {
  if (!messages) {
    return undefined
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as Record<string, unknown>
    if (message?.role !== 'assistant') {
      continue
    }
    const content = textFromContent(message.content).trim()
    if (!content) {
      continue
    }
    return {
      content,
      timestamp: typeof message.timestamp === 'number' ? message.timestamp : undefined,
    }
  }
  return undefined
}

function getReportFingerprint(
  routeKey: string,
  workerId: string,
  message: { content: string; timestamp?: number },
): string {
  return `${routeKey}|${workerId}|${message.timestamp ?? 0}|${message.content}`
}

/**
 * Worker-only helper for sending the final assistant message back to the main session.
 */
export async function reportFinalAssistantMessageToMain(
  _pi: ExtensionAPI,
  ctx: ExtensionContext,
  options: ReportBackOptions,
): Promise<void> {
  const workerId = options.workerId ?? process.env.PI_CLAWAS_WORKER_ID ?? 'unknown'
  if (!options.targetSessionId) {
    return
  }

  const message =
    getLastAssistantMessage(ctx) ?? getLastAssistantFromAgentEndMessages(options.agentMessages)
  if (!message?.content) {
    return
  }

  const lastMailDetails = getLastMailMessageDetails(ctx)

  const lastDelivery = getLastDeliveryMessage(ctx)
  if (
    shouldSkipAutoMainClawStatusRelay({
      lastDelivery,
      lastMailTimestamp: getLastMailMessageTimestamp(ctx),
    })
  ) {
    return
  }

  const reportMode = process.env.PI_CLAWAS_REPORT_MODE?.trim() || 'auto'
  if (reportMode === 'off') {
    return
  }

  if (
    !shouldReportClawaFinalToMain({
      messageContent: message.content,
      lastMailDetails,
    })
  ) {
    return
  }

  const reportContent =
    reportMode === 'explicit' ? extractClawaReportText(message.content) : message.content
  if (!reportContent) {
    return
  }

  const reportFingerprint = getReportFingerprint(options.targetSessionId, workerId, {
    content: reportContent,
    timestamp: message.timestamp,
  })
  if (lastReportByWorker.get(workerId) === reportFingerprint) {
    return
  }
  lastReportByWorker.set(workerId, reportFingerprint)

  await sendClawasSessionMessage(options.targetSessionId, {
    message: reportContent,
    messageType: 'report',
    sender: {
      workerId: options.workerId,
      workerTitle: options.workerTitle,
    },
    kind: 'report',
    intent: 'status',
    visibility: 'private',
  })
}
