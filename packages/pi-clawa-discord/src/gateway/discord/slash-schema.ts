import { ApplicationCommandType, ContextMenuCommandBuilder, SlashCommandBuilder } from 'discord.js'

export const PI_COMMAND = new SlashCommandBuilder()
  .setName('pi')
  .setDescription('Inspect the Clawa Discord route for this channel')
  .addSubcommand((sub) =>
    sub.setName('status').setDescription('Show the Clawa Discord route and worker status'),
  )

export const ASK_CLAWA_COMMAND = new ContextMenuCommandBuilder()
  .setName('Ask Clawa')
  .setType(ApplicationCommandType.Message)
