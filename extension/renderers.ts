import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'
import { CLAWAS_MAIL_MESSAGE_TYPE, CLAWAS_OUTBOUND_MESSAGE_TYPE } from '../clawas/comms/outbound.js'
import { createClawasCommsRenderer } from '../clawas/comms/renderers.js'
import type { resolveClawaDefaults } from '../config.js'
import { CLAWA_PULSE_MESSAGE_TYPE, type PulseMessageDetails } from '../pulses/message.js'
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

  pi.registerMessageRenderer(CLAWA_PULSE_MESSAGE_TYPE, (message, _options, theme) => {
    const details = message.details as PulseMessageDetails | undefined
    const title = details?.pulseTitle ?? 'Pulse'
    const owner = details?.ownerTitle ?? details?.ownerId ?? 'Clawa'
    const file = details?.file ? ` · ${details.file}` : ''
    const forced = details?.forced ? ' run-now' : ''
    return new Text(theme.fg('muted', `Pulse${forced}: ${title} → ${owner}${file}`), 0, 0)
  })

  const clawasCommsRenderer = createClawasCommsRenderer(getCurrentDefaults)
  pi.registerMessageRenderer(CLAWAS_OUTBOUND_MESSAGE_TYPE, clawasCommsRenderer)
  pi.registerMessageRenderer(CLAWAS_MAIL_MESSAGE_TYPE, clawasCommsRenderer)
  pi.registerMessageRenderer('clawas-session', clawasCommsRenderer)
  pi.registerMessageRenderer('clawas-report', clawasCommsRenderer)
}
