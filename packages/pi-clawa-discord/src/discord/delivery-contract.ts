import { statSync } from 'node:fs'

type DiscordButtonStyle = 'primary' | 'secondary' | 'success' | 'danger'

export interface DiscordFileInput {
  path: string
  description?: string | undefined
  spoiler?: boolean | undefined
}

interface DiscordModalInput {
  title: string
  label: string
  prompt?: string | undefined
  placeholder?: string | undefined
  required?: boolean | undefined
}

export interface DiscordButtonInput {
  label: string
  prompt?: string | undefined
  style?: DiscordButtonStyle | undefined
  url?: string | undefined
  modal?: DiscordModalInput | undefined
}

interface DiscordSelectInput {
  placeholder: string
  options: Array<{ label: string; prompt?: string | undefined; description?: string | undefined }>
  minValues?: number | undefined
  maxValues?: number | undefined
}

interface DiscordPollInput {
  question: string
  answers: string[]
  durationHours?: number | undefined
  allowMultiselect?: boolean | undefined
}

export interface DiscordDeliveryRequest {
  channelId: string
  message?: string | undefined
  title?: string | undefined
  card?: boolean | undefined
  replyToMessageId?: string | undefined
  files: DiscordFileInput[]
  buttons?: DiscordButtonInput[] | undefined
  select?: DiscordSelectInput | undefined
  poll?: DiscordPollInput | undefined
  reaction?: { channelId: string; messageId: string; emoji: string } | undefined
}

export interface DiscordDeliveryResult {
  messageId?: string | undefined
  sentFiles: number
  sentText: boolean
  reacted: boolean
}

const BUTTON_URL = /^(?:https?:\/\/|discord:\/\/)/iu

export function validateDiscordDelivery(
  request: DiscordDeliveryRequest,
  limits: { maxFileBytes: number; maxTotalBytes: number },
): void {
  const hasMessage = Boolean(
    request.message?.trim() ||
      request.title?.trim() ||
      request.files.length > 0 ||
      (request.buttons?.length ?? 0) > 0 ||
      request.select ||
      request.poll,
  )
  if (!(hasMessage || request.reaction)) {
    throw new Error('A message, file, interaction, poll, or reaction is required.')
  }
  if (request.files.length > 10) throw new Error('Discord accepts at most 10 files.')
  if ((request.buttons?.length ?? 0) > 5) throw new Error('Discord accepts at most 5 buttons.')
  if (request.card && request.poll) throw new Error('A Discord card cannot contain a poll.')

  validateFiles(request.files, limits)
  validateButtons(request.buttons ?? [])
  if (request.select) validateSelect(request.select)
  if (request.poll) validatePoll(request.poll)
}

function validateFiles(
  files: DiscordFileInput[],
  limits: { maxFileBytes: number; maxTotalBytes: number },
): void {
  let total = 0
  for (const file of files) {
    let size: number
    try {
      size = statSync(file.path).size
    } catch {
      throw new Error(`File not found: ${file.path}`)
    }
    if (limits.maxFileBytes > 0 && size > limits.maxFileBytes) {
      throw new Error(`File exceeds the attachment limit: ${file.path}`)
    }
    total += size
  }
  if (limits.maxTotalBytes > 0 && total > limits.maxTotalBytes) {
    throw new Error('Files exceed the combined attachment limit.')
  }
}

function validateButtons(buttons: DiscordButtonInput[]): void {
  for (const button of buttons) {
    if (!button.label.trim()) throw new Error('Discord button labels cannot be empty.')
    if (button.url && (button.prompt || button.modal)) {
      throw new Error(`Link button ${button.label} cannot also start a Pi turn.`)
    }
    if (button.url && !BUTTON_URL.test(button.url.trim())) {
      throw new Error(`Link button ${button.label} needs an HTTP, HTTPS, or Discord URL.`)
    }
  }
}

function validateSelect(select: DiscordSelectInput): void {
  if (select.options.length === 0 || select.options.length > 25) {
    throw new Error('A Discord select needs between 1 and 25 options.')
  }
  const minimum = select.minValues ?? 1
  const maximum = select.maxValues ?? 1
  if (minimum < 0 || maximum < 1 || minimum > maximum || maximum > select.options.length) {
    throw new Error('Discord select minimum and maximum values are invalid.')
  }
}

function validatePoll(poll: DiscordPollInput): void {
  if (poll.answers.length < 2 || poll.answers.length > 10) {
    throw new Error('A Discord poll needs between 2 and 10 answers.')
  }
  const duration = poll.durationHours ?? 24
  if (duration < 1 || duration > 24 * 32) {
    throw new Error('Discord poll duration must be between 1 hour and 32 days.')
  }
}
