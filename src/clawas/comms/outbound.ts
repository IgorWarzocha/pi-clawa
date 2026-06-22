import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { ClawaDefaults } from '../../config'

export const CLAWAS_OUTBOUND_MESSAGE_TYPE = 'clawas-outbound'
export const CLAWAS_MAIL_MESSAGE_TYPE = 'clawas-mail'
export const CLAWAS_DELIVERY_MESSAGE_TYPE = 'clawas-delivery'

export type ClawasOutboundMode = 'prompt' | 'steer' | 'followUp'
export type ClawasDeliveryRoute = 'discord' | 'main-claw'

export interface ClawasOutboundDetails {
  workerId: string
  workerTitle: string
  mode: ClawasOutboundMode
  sourceTitle: string
  message: string
}

const OUTBOUND_CONTEXT_MARKER =
  'Display-only Clawa routing marker. The main Clawa sent a private note to another Clawa; do not answer this marker in the main chat.'

export interface ClawasDeliveryDetails {
  route: ClawasDeliveryRoute
  workerId?: string | undefined
  workerTitle?: string | undefined
}

export function publishClawasOutboundMessage(
  pi: ExtensionAPI,
  clawaDefaults: ClawaDefaults,
  worker: { id: string; title: string },
  message: string,
  mode: ClawasOutboundMode,
  sourceTitle = clawaDefaults.mainClawName,
): void {
  pi.sendMessage<ClawasOutboundDetails>({
    customType: CLAWAS_OUTBOUND_MESSAGE_TYPE,
    content: OUTBOUND_CONTEXT_MARKER,
    display: true,
    details: {
      workerId: worker.id,
      workerTitle: worker.title,
      mode,
      sourceTitle,
      message,
    },
  })
}

export function publishClawasDeliveryMessage(
  pi: ExtensionAPI,
  message: string,
  details: ClawasDeliveryDetails,
): void {
  pi.sendMessage<ClawasDeliveryDetails>({
    customType: CLAWAS_DELIVERY_MESSAGE_TYPE,
    content: message,
    display: false,
    details,
  })
}
