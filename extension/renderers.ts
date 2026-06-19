import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'
import { CLAWAS_MAIL_MESSAGE_TYPE, CLAWAS_OUTBOUND_MESSAGE_TYPE } from '../clawas/comms/outbound.js'
import { createClawasCommsRenderer } from '../clawas/comms/renderers.js'
import type { resolveClawaDefaults } from '../config.js'
import { formatMessageContent } from './ui-notes.js'

export function registerClawaRenderers(
  pi: ExtensionAPI,
  getCurrentDefaults: () => ReturnType<typeof resolveClawaDefaults>,
): void {
  pi.registerMessageRenderer('claw-dim', (message, _options, theme) => {
    const text = formatMessageContent(
      message.content as string | Array<{ type: string; text?: string }>,
    )
    return new Text(theme.fg('dim', text), 0, 0)
  })

  const clawasCommsRenderer = createClawasCommsRenderer(getCurrentDefaults)
  pi.registerMessageRenderer(CLAWAS_OUTBOUND_MESSAGE_TYPE, clawasCommsRenderer)
  pi.registerMessageRenderer(CLAWAS_MAIL_MESSAGE_TYPE, clawasCommsRenderer)
  pi.registerMessageRenderer('clawas-session', clawasCommsRenderer)
  pi.registerMessageRenderer('clawas-report', clawasCommsRenderer)
}
