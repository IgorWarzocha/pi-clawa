import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import {
  AttachmentBuilder,
  type Client,
  ContainerBuilder,
  type DMChannel,
  FileBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  type MessageCreateOptions,
  MessageFlags,
  type TextChannel,
  TextDisplayBuilder,
} from 'discord.js'
import type { DiscordConfig } from '../config.js'
import { type DiscordActionRow, prepareDiscordComponents } from './delivery-components.js'
import {
  type DiscordDeliveryRequest,
  type DiscordDeliveryResult,
  type DiscordFileInput,
  validateDiscordDelivery,
} from './delivery-contract.js'
import type { DiscordInteractionStore } from './interaction-store.js'
import { splitDiscordMessage } from './text.js'

interface PreparedFile {
  input: DiscordFileInput
  name: string
  attachment: AttachmentBuilder
}

const IMAGE_EXTENSION = /^\.(?:avif|gif|jpe?g|png|webp)$/iu

export async function sendDiscordDelivery(
  client: Client,
  store: DiscordInteractionStore,
  config: DiscordConfig,
  request: DiscordDeliveryRequest,
  nonce = randomBytes(12).toString('hex'),
): Promise<DiscordDeliveryResult> {
  validateDiscordDelivery(request, {
    maxFileBytes: config.maxAttachmentBytes,
    maxTotalBytes: config.maxTotalAttachmentBytes,
  })
  const channel = await client.channels.fetch(request.channelId)
  if (!(channel && 'send' in channel)) {
    throw new Error(`Discord channel is unavailable: ${request.channelId}`)
  }
  const textChannel = channel as TextChannel | DMChannel
  const reacted = request.reaction
    ? await deliverReaction(
        client,
        request.reaction.channelId,
        request.reaction.messageId,
        request.reaction.emoji,
      )
    : false
  if (!hasMessage(request)) {
    return { sentFiles: 0, sentText: false, reacted }
  }
  if (isPlainText(request)) return await sendPlainText(textChannel, request, nonce, reacted)

  const files = await prepareFiles(request.files)
  const components = prepareDiscordComponents(request, store)
  try {
    const payload = request.card
      ? buildCardPayload(request, files, components.rows, nonce)
      : buildMessagePayload(request, files, components.rows, nonce)
    const sent = await textChannel.send(payload)
    store.attach(components.tokens, sent.id)
    return {
      messageId: sent.id,
      sentFiles: files.length,
      sentText: Boolean(request.message?.trim() || request.title?.trim()),
      reacted,
    }
  } catch (error) {
    store.delete(components.tokens)
    throw error
  }
}

function hasMessage(request: DiscordDeliveryRequest): boolean {
  return Boolean(
    request.message?.trim() ||
      request.title?.trim() ||
      request.files.length > 0 ||
      (request.buttons?.length ?? 0) > 0 ||
      request.select ||
      request.poll,
  )
}

function isPlainText(request: DiscordDeliveryRequest): boolean {
  return Boolean(
    request.message?.trim() &&
      !request.title?.trim() &&
      !request.card &&
      request.files.length === 0 &&
      (request.buttons?.length ?? 0) === 0 &&
      !request.select &&
      !request.poll,
  )
}

async function sendPlainText(
  channel: TextChannel | DMChannel,
  request: DiscordDeliveryRequest,
  nonce: string,
  reacted: boolean,
): Promise<DiscordDeliveryResult> {
  const chunks = splitDiscordMessage(request.message ?? '')
  let messageId: string | undefined
  for (const [index, chunk] of chunks.entries()) {
    const sent = await channel.send({
      content: chunk,
      nonce: childNonce(nonce, index),
      enforceNonce: true,
      allowedMentions: { parse: ['users'], repliedUser: false },
      ...(index === 0 && request.replyToMessageId
        ? { reply: { messageReference: request.replyToMessageId, failIfNotExists: true } }
        : {}),
    })
    messageId = sent.id
  }
  return { messageId, sentFiles: 0, sentText: chunks.length > 0, reacted }
}

function buildMessagePayload(
  request: DiscordDeliveryRequest,
  files: PreparedFile[],
  rows: DiscordActionRow[],
  nonce: string,
): MessageCreateOptions {
  const content = formatDeliveryText(request)
  if (content.length > 2_000) {
    throw new Error('Discord messages with files or interactions must fit 2,000 characters.')
  }
  return {
    nonce,
    enforceNonce: true,
    ...(content ? { content } : {}),
    ...(files.length > 0 ? { files: files.map((file) => file.attachment) } : {}),
    ...(rows.length > 0 ? { components: rows } : {}),
    ...(request.poll
      ? {
          poll: {
            question: { text: request.poll.question },
            answers: request.poll.answers.map((answer) => ({ text: answer })),
            duration: request.poll.durationHours ?? 24,
            allowMultiselect: request.poll.allowMultiselect ?? false,
          },
        }
      : {}),
    allowedMentions: { parse: ['users'], repliedUser: false },
    ...(request.replyToMessageId
      ? { reply: { messageReference: request.replyToMessageId, failIfNotExists: true } }
      : {}),
  }
}

function buildCardPayload(
  request: DiscordDeliveryRequest,
  files: PreparedFile[],
  rows: DiscordActionRow[],
  nonce: string,
): MessageCreateOptions {
  const container = new ContainerBuilder().setAccentColor(0x8b7cf6)
  const text = formatDeliveryText(request)
  if (text) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
  const images = files.filter((file) => IMAGE_EXTENSION.test(extname(file.name)))
  if (images.length > 0) {
    const gallery = new MediaGalleryBuilder().addItems(
      ...images.map((file) => {
        const item = new MediaGalleryItemBuilder().setURL(`attachment://${file.name}`)
        if (file.input.description) item.setDescription(file.input.description)
        if (file.input.spoiler) item.setSpoiler(true)
        return item
      }),
    )
    container.addMediaGalleryComponents(gallery)
  }
  for (const file of files.filter((item) => !IMAGE_EXTENSION.test(extname(item.name)))) {
    container.addFileComponents(
      new FileBuilder().setURL(`attachment://${file.name}`).setSpoiler(file.input.spoiler),
    )
  }
  for (const row of rows) container.addActionRowComponents(row)

  return {
    nonce,
    enforceNonce: true,
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    files: files.map((file) => file.attachment),
    allowedMentions: { parse: ['users'], repliedUser: false },
    ...(request.replyToMessageId
      ? { reply: { messageReference: request.replyToMessageId, failIfNotExists: true } }
      : {}),
  }
}

async function prepareFiles(files: DiscordFileInput[]): Promise<PreparedFile[]> {
  const names = new Set<string>()
  return await Promise.all(
    files.map(async (input, index) => {
      const original = basename(input.path)
      const name = uniqueName(input.spoiler ? `SPOILER_${original}` : original, index, names)
      const attachment = new AttachmentBuilder(await readFile(input.path), { name })
      if (input.description) attachment.setDescription(input.description)
      return { input, name, attachment }
    }),
  )
}

function uniqueName(name: string, index: number, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name)
    return name
  }
  const extension = extname(name)
  const value = `${name.slice(0, name.length - extension.length)}-${index + 1}${extension}`
  used.add(value)
  return value
}

async function deliverReaction(
  client: Client,
  channelId: string,
  messageId: string,
  emoji: string,
): Promise<boolean> {
  const channel = await client.channels.fetch(channelId)
  if (!(channel && 'messages' in channel)) {
    throw new Error(`Discord reaction channel is unavailable: ${channelId}`)
  }
  const message = await (channel as TextChannel | DMChannel).messages.fetch(messageId)
  await message.react(emoji)
  return true
}

function formatDeliveryText(request: DiscordDeliveryRequest): string {
  return [request.title?.trim() ? `# ${request.title.trim()}` : '', request.message?.trim() ?? '']
    .filter(Boolean)
    .join('\n\n')
}

function childNonce(nonce: string, index: number): string {
  return createHash('sha256').update(`${nonce}:${index}`).digest('hex').slice(0, 24)
}
