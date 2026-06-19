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
}

export interface ClawasDeliveryDetails {
  route: ClawasDeliveryRoute
  workerId?: string
  workerTitle?: string
}

export function publishClawasOutboundMessage(
  pi: ExtensionAPI,
  clawaDefaults: ClawaDefaults,
  worker: { id: string; title: string },
  message: string,
  mode: ClawasOutboundMode,
): void {
  pi.sendMessage<ClawasOutboundDetails>({
    customType: CLAWAS_OUTBOUND_MESSAGE_TYPE,
    content: message,
    display: true,
    details: {
      workerId: worker.id,
      workerTitle: worker.title,
      mode,
      sourceTitle: clawaDefaults.mainClawName,
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
