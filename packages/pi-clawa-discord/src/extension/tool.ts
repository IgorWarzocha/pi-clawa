import { StringEnum } from '@earendil-works/pi-ai'
import { defineTool, type ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { type Static, Type } from 'typebox'
import type { DiscordDeliveryResult } from '../discord/delivery-contract.js'

const fileSchema = Type.Object(
  {
    path: Type.String(),
    description: Type.Optional(Type.String()),
    spoiler: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
)

const buttonSchema = Type.Object(
  {
    label: Type.String(),
    prompt: Type.Optional(Type.String({ description: 'Pi input on click' })),
    style: Type.Optional(StringEnum(['primary', 'secondary', 'success', 'danger'] as const)),
    url: Type.Optional(Type.String()),
    modal: Type.Optional(
      Type.Object(
        {
          title: Type.String(),
          label: Type.String(),
          prompt: Type.Optional(Type.String({ description: 'Pi input before submitted text' })),
          placeholder: Type.Optional(Type.String()),
          required: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
)

const discordToolSchema = Type.Object(
  {
    channel: Type.Optional(Type.String({ description: 'dm, #name, or current (default)' })),
    replyTo: Type.Optional(Type.String({ description: 'mN message handle' })),
    message: Type.Optional(Type.String()),
    title: Type.Optional(Type.String()),
    card: Type.Optional(Type.Boolean({ description: 'Discord card layout' })),
    files: Type.Optional(Type.Array(fileSchema, { maxItems: 10 })),
    buttons: Type.Optional(Type.Array(buttonSchema, { maxItems: 5 })),
    select: Type.Optional(
      Type.Object(
        {
          placeholder: Type.String(),
          options: Type.Array(
            Type.Object(
              {
                label: Type.String(),
                prompt: Type.Optional(Type.String({ description: 'Pi input when selected' })),
                description: Type.Optional(Type.String()),
              },
              { additionalProperties: false },
            ),
            { minItems: 1, maxItems: 25 },
          ),
          minValues: Type.Optional(Type.Integer({ minimum: 0, maximum: 25 })),
          maxValues: Type.Optional(Type.Integer({ minimum: 1, maximum: 25 })),
        },
        { additionalProperties: false },
      ),
    ),
    poll: Type.Optional(
      Type.Object(
        {
          question: Type.String(),
          answers: Type.Array(Type.String(), { minItems: 2, maxItems: 10 }),
          durationHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 24 * 32 })),
          allowMultiselect: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
    ),
    reaction: Type.Optional(
      Type.Object(
        {
          to: Type.String({ description: 'mN message handle' }),
          emoji: Type.String(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
)

export type DiscordToolInput = Static<typeof discordToolSchema>

export interface DiscordToolTarget {
  sendFromTool(input: DiscordToolInput, cwd: string): Promise<DiscordDeliveryResult>
}

export function registerDiscordTool(
  pi: ExtensionAPI,
  getTarget: () => DiscordToolTarget | undefined,
) {
  const tool = defineTool<typeof discordToolSchema, DiscordDeliveryResult>({
    name: 'discord_send',
    label: 'Discord Send',
    description: 'Rich Discord delivery or DM; ordinary room replies use marked final text.',
    parameters: discordToolSchema,
    async execute(_toolCallId, input, _signal, _onUpdate, ctx) {
      const target = getTarget()
      if (!target) throw new Error('Clawa is not running in this Pi session.')
      const result = await target.sendFromTool(input, ctx.cwd)
      const effects = [
        result.sentText ? 'text' : '',
        result.sentFiles > 0 ? `${result.sentFiles} file(s)` : '',
        result.reacted ? 'reaction' : '',
      ].filter(Boolean)
      return {
        content: [
          {
            type: 'text' as const,
            text: `Delivered to Discord${effects.length > 0 ? `: ${effects.join(', ')}` : ''}.`,
          },
        ],
        details: result,
      }
    },
  })
  pi.registerTool(tool)
  return tool
}
