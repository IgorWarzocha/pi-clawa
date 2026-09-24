import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js'
import type { DiscordButtonInput, DiscordDeliveryRequest } from './delivery-contract.js'
import type { DiscordInteractionStore } from './interaction-store.js'

export type DiscordActionRow = ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>

export interface PreparedDiscordComponents {
  rows: DiscordActionRow[]
  tokens: string[]
}

export function prepareDiscordComponents(
  request: DiscordDeliveryRequest,
  store: DiscordInteractionStore,
): PreparedDiscordComponents {
  const rows: DiscordActionRow[] = []
  const tokens: string[] = []
  if ((request.buttons?.length ?? 0) > 0) {
    const row = new ActionRowBuilder<ButtonBuilder>()
    for (const button of request.buttons ?? []) {
      row.addComponents(prepareButton(request.channelId, button, store, tokens))
    }
    rows.push(row)
  }

  if (request.select) {
    const options = Object.fromEntries(
      request.select.options.map((option, index) => [
        String(index),
        option.prompt?.trim() || `I chose “${option.label}”.`,
      ]),
    )
    const token = store.create(request.channelId, { type: 'select', options })
    tokens.push(token)
    const select = new StringSelectMenuBuilder()
      .setCustomId(`clawa-discord:select:${token}`)
      .setPlaceholder(request.select.placeholder)
      .setMinValues(request.select.minValues ?? 1)
      .setMaxValues(request.select.maxValues ?? 1)
      .addOptions(
        ...request.select.options.map((option, index) => {
          const item = new StringSelectMenuOptionBuilder()
            .setLabel(option.label)
            .setValue(String(index))
          if (option.description) item.setDescription(option.description)
          return item
        }),
      )
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select))
  }
  return { rows, tokens }
}

function prepareButton(
  channelId: string,
  input: DiscordButtonInput,
  store: DiscordInteractionStore,
  tokens: string[],
): ButtonBuilder {
  const button = new ButtonBuilder().setLabel(input.label)
  if (input.url) return button.setStyle(ButtonStyle.Link).setURL(input.url)

  if (input.modal) {
    const token = store.create(channelId, {
      type: 'modal',
      title: input.modal.title,
      label: input.modal.label,
      prompt: input.modal.prompt?.trim() || `I chose “${input.label}” and added:`,
      placeholder: input.modal.placeholder,
      required: input.modal.required ?? true,
    })
    tokens.push(token)
    return button.setCustomId(`clawa-discord:modal:${token}`).setStyle(buttonStyle(input.style))
  }

  const token = store.create(channelId, {
    type: 'prompt',
    prompt: input.prompt?.trim() || `I chose “${input.label}”.`,
  })
  tokens.push(token)
  return button.setCustomId(`clawa-discord:button:${token}`).setStyle(buttonStyle(input.style))
}

function buttonStyle(style: DiscordButtonInput['style']): ButtonStyle {
  if (style === 'primary') return ButtonStyle.Primary
  if (style === 'success') return ButtonStyle.Success
  if (style === 'danger') return ButtonStyle.Danger
  return ButtonStyle.Secondary
}
