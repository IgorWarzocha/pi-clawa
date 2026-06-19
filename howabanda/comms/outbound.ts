import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { BurrowDefaults } from '../../config'

export const HOWABANDA_OUTBOUND_MESSAGE_TYPE = 'howabanda-outbound'
export const HOWABANDA_MAIL_MESSAGE_TYPE = 'howabanda-mail'
export const HOWABANDA_DELIVERY_MESSAGE_TYPE = 'howabanda-delivery'

export type HowabandaOutboundMode = 'prompt' | 'steer' | 'followUp'
export type HowabandaDeliveryRoute = 'discord' | 'main-claw'

export interface HowabandaOutboundDetails {
  workerId: string
  workerTitle: string
  mode: HowabandaOutboundMode
  sourceTitle: string
}

export interface HowabandaDeliveryDetails {
  route: HowabandaDeliveryRoute
  workerId?: string
  workerTitle?: string
}

export function publishHowabandaOutboundMessage(
  pi: ExtensionAPI,
  burrowDefaults: BurrowDefaults,
  worker: { id: string; title: string },
  message: string,
  mode: HowabandaOutboundMode,
): void {
  pi.sendMessage<HowabandaOutboundDetails>({
    customType: HOWABANDA_OUTBOUND_MESSAGE_TYPE,
    content: message,
    display: true,
    details: {
      workerId: worker.id,
      workerTitle: worker.title,
      mode,
      sourceTitle: burrowDefaults.mainClawName,
    },
  })
}

export function publishHowabandaDeliveryMessage(
  pi: ExtensionAPI,
  message: string,
  details: HowabandaDeliveryDetails,
): void {
  pi.sendMessage<HowabandaDeliveryDetails>({
    customType: HOWABANDA_DELIVERY_MESSAGE_TYPE,
    content: message,
    display: false,
    details,
  })
}
