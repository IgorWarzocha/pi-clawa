export type DiscordButtonStyle = 'primary' | 'secondary' | 'success' | 'danger'

export interface DiscordFileInput {
  path: string
  description?: string | undefined
  spoiler?: boolean | undefined
}

export interface DiscordModalInput {
  title: string
  label: string
  prompt?: string | undefined
  placeholder?: string | undefined
  required?: boolean | undefined
}

export interface DiscordActionInput {
  label: string
  prompt?: string | undefined
  style?: DiscordButtonStyle | undefined
  url?: string | undefined
  modal?: DiscordModalInput | undefined
}

export interface DiscordSelectOptionInput {
  label: string
  prompt?: string | undefined
  description?: string | undefined
}

export interface DiscordSelectInput {
  placeholder: string
  options: DiscordSelectOptionInput[]
  minValues?: number | undefined
  maxValues?: number | undefined
}

export interface DiscordPollInput {
  question: string
  answers: string[]
  durationHours?: number | undefined
  allowMultiselect?: boolean | undefined
}

export interface DiscordReactionInput {
  channelJid: string
  messageId: string
  emoji: string
}

export interface DiscordDeliveryRequest {
  channelJid: string
  /** Typing lease completed when this intent reaches a terminal state. */
  typingJid?: string | undefined
  text?: string | undefined
  title?: string | undefined
  card?: boolean | undefined
  replyToMessageId?: string | undefined
  files: DiscordFileInput[]
  actions?: DiscordActionInput[] | undefined
  select?: DiscordSelectInput | undefined
  poll?: DiscordPollInput | undefined
  reaction?: DiscordReactionInput | undefined
}

export interface DiscordDeliveryResult {
  messageId?: string | undefined
  sentFiles: number
  sentText: boolean
  reacted: boolean
}

export interface DiscordDeliveryQueueState {
  status: 'pending' | 'processing' | 'done' | 'dead'
  attempts: number
  result?: DiscordDeliveryResult | undefined
  error?: string | undefined
}

const DISCORD_BUTTON_URL_PATTERN = /^(?:https?:\/\/|discord:\/\/)/iu

export function validateDiscordDeliveryRequest(
  request: DiscordDeliveryRequest,
  options: {
    maxAttachmentBytes: number
    maxTotalAttachmentBytes: number
    fileStat: (path: string) => { size: number }
  },
): void {
  const hasMessage = Boolean(
    request.text?.trim() ||
      request.title?.trim() ||
      request.files.length > 0 ||
      (request.actions?.length ?? 0) > 0 ||
      request.select ||
      request.poll,
  )
  if (!(hasMessage || request.reaction)) {
    throw new Error('A message, file, interaction, poll, or reaction is required.')
  }
  if (request.files.length > 10) {
    throw new Error('At most 10 files can be sent in one Discord message.')
  }
  if ((request.actions?.length ?? 0) > 5) {
    throw new Error('At most 5 Discord buttons can be sent in one action row.')
  }
  if (request.card && request.poll) {
    throw new Error('Discord cards and polls are separate message modes.')
  }

  validateDiscordFiles(request.files, options)
  validateDiscordActions(request.actions ?? [])
  if (request.select) validateDiscordSelect(request.select)
  if (request.poll) validateDiscordPoll(request.poll)
}

function validateDiscordFiles(
  files: DiscordFileInput[],
  options: {
    maxAttachmentBytes: number
    maxTotalAttachmentBytes: number
    fileStat: (path: string) => { size: number }
  },
): void {
  let totalBytes = 0
  for (const file of files) {
    let stat: { size: number }
    try {
      stat = options.fileStat(file.path)
    } catch {
      throw new Error(`File not found: ${file.path}`)
    }
    if (options.maxAttachmentBytes > 0 && stat.size > options.maxAttachmentBytes) {
      throw new Error(
        `File exceeds max attachment size (${options.maxAttachmentBytes} bytes): ${file.path}`,
      )
    }
    totalBytes += stat.size
  }
  if (options.maxTotalAttachmentBytes > 0 && totalBytes > options.maxTotalAttachmentBytes) {
    throw new Error(
      `Files exceed max combined attachment size (${options.maxTotalAttachmentBytes} bytes).`,
    )
  }
}

function validateDiscordActions(actions: DiscordActionInput[]): void {
  for (const action of actions) {
    if (!action.label.trim()) throw new Error('Discord button labels cannot be empty.')
    if (action.url && (action.prompt || action.modal)) {
      throw new Error(`Discord link button ${action.label} cannot also trigger Clawa.`)
    }
    if (action.url && !isDiscordButtonUrl(action.url)) {
      throw new Error(`Discord link button ${action.label} needs an http, https, or discord URL.`)
    }
  }
}

function validateDiscordSelect(select: DiscordSelectInput): void {
  if (select.options.length === 0 || select.options.length > 25) {
    throw new Error('Discord selects need between 1 and 25 options.')
  }
  const maxValues = select.maxValues ?? 1
  const minValues = select.minValues ?? 1
  if (minValues < 0 || maxValues < 1 || minValues > maxValues) {
    throw new Error('Discord select min/max values are invalid.')
  }
  if (maxValues > select.options.length) {
    throw new Error('Discord select max values exceed the number of options.')
  }
}

function validateDiscordPoll(poll: DiscordPollInput): void {
  if (poll.answers.length < 2 || poll.answers.length > 10) {
    throw new Error('Discord polls need between 2 and 10 answers.')
  }
  const duration = poll.durationHours ?? 24
  if (duration < 1 || duration > 24 * 32) {
    throw new Error('Discord poll duration must be between 1 hour and 32 days.')
  }
}

function isDiscordButtonUrl(value: string): boolean {
  return DISCORD_BUTTON_URL_PATTERN.test(value.trim())
}
