import type {
  ClawasMessageIntent,
  ClawasMessageKind,
  ClawasMessageVisibility,
  ClawasSendCommand,
  ClawasSenderInfo,
} from './types.js'

const LEGACY_SESSION_MESSAGE_TYPE = 'clawas-session'
const LEGACY_REPORT_MESSAGE_TYPE = 'clawas-report'

export function resolveMessageKind(command: ClawasSendCommand): ClawasMessageKind {
  if (command.kind) {
    return command.kind
  }

  if (command.messageType === 'report') {
    return 'report'
  }

  return 'mail'
}

export function resolveMessageIntent(
  command: ClawasSendCommand,
  kind: ClawasMessageKind,
): ClawasMessageIntent {
  if (command.intent) {
    return command.intent
  }

  if (kind === 'report') {
    return 'status'
  }

  return 'reply_requested'
}

export function resolveMessageVisibility(
  command: ClawasSendCommand,
  kind: ClawasMessageKind,
): ClawasMessageVisibility {
  if (command.visibility) {
    return command.visibility
  }

  if (kind === 'report') {
    return 'private'
  }

  return 'worker'
}

export function buildMessageDetails(
  sender: ClawasSenderInfo | undefined,
  kind: ClawasMessageKind,
  intent: ClawasMessageIntent,
  visibility: ClawasMessageVisibility,
) {
  return {
    workerId: sender?.workerId,
    workerTitle: sender?.workerTitle,
    kind,
    intent,
    visibility,
  }
}

export function buildClawasMailContext(
  message: string,
  details: ReturnType<typeof buildMessageDetails>,
): string {
  const title = details.workerTitle || details.workerId || 'another Clawa'
  return [`[${title}]`, message].join('\n')
}

export function getLegacyMailCustomType(command: ClawasSendCommand): string {
  return command.messageType === 'report' ? LEGACY_REPORT_MESSAGE_TYPE : LEGACY_SESSION_MESSAGE_TYPE
}

export function shouldTriggerTurn(command: ClawasSendCommand): boolean {
  return command.intent !== 'for_context'
}
