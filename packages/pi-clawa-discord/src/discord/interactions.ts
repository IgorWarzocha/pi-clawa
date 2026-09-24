import {
  ActionRowBuilder,
  ApplicationCommandType,
  type ButtonInteraction,
  type Client,
  ContextMenuCommandBuilder,
  type Interaction,
  type Message,
  type MessageContextMenuCommandInteraction,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  SlashCommandBuilder,
  type StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js'
import type { DiscordInboundTurn } from '../bridge/contracts.js'
import type { DiscordConfig } from '../config.js'
import type { DiscordActivityEvent } from './activity.js'
import type { DiscordInteractionAction, DiscordInteractionStore } from './interaction-store.js'
import { canUseDiscordChannel } from './policy.js'
import { humanizeDiscordText, sanitizeDiscordLabel } from './sanitize.js'

const COMPONENT_ID = /^clawa-discord:(button|modal|select):([A-Za-z0-9_-]+)$/u
const MODAL_SUBMIT_ID = /^clawa-discord:modal-submit:([A-Za-z0-9_-]+)$/u
const ASK_MODAL_ID = /^clawa-discord:ask:([0-9]+)$/u
const MODAL_FIELD = 'clawa-discord-input'

const STATUS_COMMAND = new SlashCommandBuilder()
  .setName('clawa')
  .setDescription('Inspect the live Clawa connection')
  .addSubcommand((command) => command.setName('status').setDescription('Show Clawa status'))

const ASK_COMMAND = new ContextMenuCommandBuilder()
  .setName('Ask Clawa')
  .setType(ApplicationCommandType.Message)

export interface DiscordInteractionDependencies {
  config: DiscordConfig
  store: DiscordInteractionStore
  chatEnabled(): boolean
  observe(event: DiscordActivityEvent): void
  enqueue(turn: DiscordInboundTurn): boolean
  describeStatus(): string
}

export async function registerDiscordCommands(client: Client<true>): Promise<void> {
  const commands = await client.application.commands.fetch()
  for (const body of [STATUS_COMMAND.toJSON(), ASK_COMMAND.toJSON()]) {
    const current = commands.find(
      (command) =>
        command.name === body.name &&
        command.type === (body.type ?? ApplicationCommandType.ChatInput),
    )
    if (current) await client.application.commands.edit(current.id, body)
    else await client.application.commands.create(body)
  }
}

export async function handleDiscordInteraction(
  interaction: Interaction,
  dependencies: DiscordInteractionDependencies,
): Promise<void> {
  if (
    (dependencies.config.allowedUserIds.size > 0 &&
      !dependencies.config.allowedUserIds.has(interaction.user.id)) ||
    !interaction.channelId ||
    !canUseDiscordChannel(dependencies.config, interaction.channelId, !interaction.inGuild())
  ) {
    if (interaction.isRepliable()) {
      await interaction.reply({
        content: 'This Clawa does not accept turns from this account or channel.',
        ...ephemeral(interaction.inGuild()),
      })
    }
    return
  }
  if (interaction.isChatInputCommand() && interaction.commandName === 'clawa') {
    await interaction.reply({
      content: dependencies.describeStatus(),
      ...ephemeral(interaction.inGuild()),
    })
    return
  }
  if (!dependencies.chatEnabled()) {
    observeInteraction(interaction, describeInteraction(interaction), 'paused', dependencies)
    await replyPaused(interaction)
    return
  }
  if (interaction.isMessageContextMenuCommand() && interaction.commandName === 'Ask Clawa') {
    await showAskModal(interaction)
    return
  }
  if (interaction.isButton()) {
    await handleButton(interaction, dependencies)
    return
  }
  if (interaction.isStringSelectMenu()) {
    await handleSelect(interaction, dependencies)
    return
  }
  if (interaction.isModalSubmit()) await handleModal(interaction, dependencies)
}

async function handleButton(
  interaction: ButtonInteraction,
  dependencies: DiscordInteractionDependencies,
): Promise<void> {
  const token = interaction.customId.match(COMPONENT_ID)?.[2]
  if (!token) return
  const action = dependencies.store.peek(token, interaction.channelId, interaction.message.id)
  if (!action) return await replyUnavailable(interaction)
  if (action.type === 'modal') {
    await interaction.showModal(buildActionModal(token, action))
    return
  }
  if (action.type !== 'prompt') return await replyUnavailable(interaction)
  if (!enqueueInteraction(interaction, action.prompt, interaction.message, dependencies)) {
    return await replyBusy(interaction)
  }
  dependencies.store.consume(token, interaction.channelId, interaction.message.id)
  await interaction.deferUpdate()
}

async function handleSelect(
  interaction: StringSelectMenuInteraction,
  dependencies: DiscordInteractionDependencies,
): Promise<void> {
  const token = interaction.customId.match(COMPONENT_ID)?.[2]
  if (!token) return
  const action = dependencies.store.peek(token, interaction.channelId, interaction.message.id)
  if (action?.type !== 'select') return await replyUnavailable(interaction)
  const prompts = interaction.values
    .map((value) => action.options[value])
    .filter((value): value is string => Boolean(value))
  if (prompts.length === 0) return await replyUnavailable(interaction)
  if (!enqueueInteraction(interaction, prompts.join('\n'), interaction.message, dependencies)) {
    return await replyBusy(interaction)
  }
  dependencies.store.consume(token, interaction.channelId, interaction.message.id)
  await interaction.deferUpdate()
}

async function handleModal(
  interaction: ModalSubmitInteraction,
  dependencies: DiscordInteractionDependencies,
): Promise<void> {
  const askMessageId = interaction.customId.match(ASK_MODAL_ID)?.[1]
  if (askMessageId) return await handleAskModal(interaction, askMessageId, dependencies)

  const token = interaction.customId.match(MODAL_SUBMIT_ID)?.[1]
  if (!(token && interaction.channelId)) return
  const action = dependencies.store.peek(token, interaction.channelId)
  if (action?.type !== 'modal') return await replyUnavailable(interaction)
  const answer = interaction.fields.getTextInputValue(MODAL_FIELD).trim()
  const body = answer ? `${action.prompt}\n${answer}` : action.prompt
  const target = await fetchMessage(interaction, undefined)
  if (!enqueueInteraction(interaction, body, target, dependencies))
    return await replyBusy(interaction)
  dependencies.store.consume(token, interaction.channelId)
  await interaction.reply({
    content: 'Passed to the live Pi session.',
    ...ephemeral(interaction.inGuild()),
  })
}

async function showAskModal(interaction: MessageContextMenuCommandInteraction): Promise<void> {
  const input = new TextInputBuilder()
    .setCustomId(MODAL_FIELD)
    .setLabel('What would you like to know?')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2_000)
  const modal = new ModalBuilder()
    .setCustomId(`clawa-discord:ask:${interaction.targetId}`)
    .setTitle('Ask Clawa about this')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
  await interaction.showModal(modal)
}

async function handleAskModal(
  interaction: ModalSubmitInteraction,
  messageId: string,
  dependencies: DiscordInteractionDependencies,
): Promise<void> {
  const target = await fetchMessage(interaction, messageId)
  if (!target) return await replyUnavailable(interaction)
  const question = interaction.fields.getTextInputValue(MODAL_FIELD).trim()
  const targetText = humanizeDiscordText(target, target.content).trim() || '[No text]'
  const body = [
    question,
    '',
    `Message from ${target.author.displayName || target.author.username}:`,
    targetText,
    ...[...target.attachments.values()].map((file) => `Attachment: ${file.name}`),
  ].join('\n')
  if (!enqueueInteraction(interaction, body, target, dependencies))
    return await replyBusy(interaction)
  await interaction.reply({
    content: 'Passed to the live Pi session.',
    ...ephemeral(interaction.inGuild()),
  })
}

function enqueueInteraction(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  body: string,
  target: Message | null,
  dependencies: DiscordInteractionDependencies,
): boolean {
  if (!interaction.channelId) return false
  const targetId = target?.id ?? interaction.message?.id
  const actorName = interactionUserName(interaction)
  const channelLabel = interaction.guild
    ? `${sanitizeDiscordLabel(interaction.guild.name)} #${channelName(interaction)}`
    : `DM with ${actorName}`
  const handles = targetId
    ? { [targetId]: { channelId: interaction.channelId, messageId: targetId } }
    : {}
  const turn: DiscordInboundTurn = {
    id: interaction.id,
    cause: 'directed',
    channelId: interaction.channelId,
    channelLabel,
    senderName: actorName,
    sourceMessageId: interaction.id,
    replyToMessageId: targetId ?? interaction.id,
    body,
    receivedAt: new Date().toISOString(),
    context: target
      ? [
          {
            kind: 'reply',
            messageId: target.id,
            senderName:
              sanitizeDiscordLabel(target.author.displayName || target.author.username) ||
              'Unknown user',
            body: humanizeDiscordText(target, target.content).trim() || '[No text]',
          },
        ]
      : [],
    attachments: [],
    handles,
  }
  const queued = dependencies.enqueue(turn)
  observeInteraction(interaction, body, queued ? 'queued' : 'full', dependencies, turn.channelLabel)
  return queued
}

function buildActionModal(
  token: string,
  action: Extract<DiscordInteractionAction, { type: 'modal' }>,
): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId(MODAL_FIELD)
    .setLabel(action.label)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(action.required)
    .setMaxLength(4_000)
  if (action.placeholder) input.setPlaceholder(action.placeholder)
  return new ModalBuilder()
    .setCustomId(`clawa-discord:modal-submit:${token}`)
    .setTitle(action.title)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
}

async function fetchMessage(
  interaction: ModalSubmitInteraction,
  messageId: string | undefined,
): Promise<Message | null> {
  if (!messageId) return interaction.message ?? null
  if (!(interaction.channel && 'messages' in interaction.channel)) return null
  return await interaction.channel.messages.fetch(messageId).catch(() => null)
}

function channelName(interaction: Interaction): string {
  if (!interaction.channel) return 'unknown-channel'
  return sanitizeDiscordLabel(
    ('name' in interaction.channel ? interaction.channel.name : null) ?? 'unknown-channel',
  )
}

async function replyUnavailable(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
): Promise<void> {
  if (interaction.replied || interaction.deferred) return
  await interaction.reply({
    content: 'That Clawa action has expired or was already used.',
    ...ephemeral(interaction.inGuild()),
  })
}

async function replyBusy(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
): Promise<void> {
  if (interaction.replied || interaction.deferred) return
  await interaction.reply({
    content: 'The live Pi session is at capacity. Try again in a moment.',
    ...ephemeral(interaction.inGuild()),
  })
}

async function replyPaused(interaction: Interaction): Promise<void> {
  if (!interaction.isRepliable() || interaction.replied || interaction.deferred) return
  await interaction.reply({
    content: 'Clawa is monitoring this room, but chat intake is paused.',
    ...ephemeral(interaction.inGuild()),
  })
}

function observeInteraction(
  interaction: Interaction,
  body: string,
  disposition: DiscordActivityEvent['disposition'],
  dependencies: DiscordInteractionDependencies,
  label = interaction.guild
    ? `${sanitizeDiscordLabel(interaction.guild.name)} #${channelName(interaction)}`
    : `DM with ${interactionUserName(interaction)}`,
): void {
  dependencies.observe({
    id: interaction.id,
    channelLabel: label,
    senderName: interactionUserName(interaction),
    body,
    occurredAt: interaction.createdTimestamp,
    disposition,
  })
}

function interactionUserName(interaction: Interaction): string {
  return (
    sanitizeDiscordLabel(interaction.user.displayName || interaction.user.username) ||
    'Unknown user'
  )
}

function describeInteraction(interaction: Interaction): string {
  if (interaction.isMessageContextMenuCommand()) return interaction.commandName
  if (interaction.isButton()) return `Button: ${interaction.customId}`
  if (interaction.isStringSelectMenu()) return `Select: ${interaction.values.join(', ')}`
  if (interaction.isModalSubmit()) return 'Modal submitted'
  return 'Discord interaction'
}

function ephemeral(inGuild: boolean): { flags?: MessageFlags.Ephemeral } {
  return inGuild ? { flags: MessageFlags.Ephemeral } : {}
}
