import { SlashCommandBuilder } from 'discord.js'

export const PI_COMMAND = new SlashCommandBuilder()
  .setName('pi')
  .setDescription('Inspect or change pi model settings for this channel')
  .addSubcommand((sub) =>
    sub
      .setName('status')
      .setDescription('Show the current model and thinking configuration for this channel'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('model')
      .setDescription('Set the default model for this channel')
      .addStringOption((option) =>
        option
          .setName('model')
          .setDescription('Choose one of pi\'s currently available models')
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('reset-model')
      .setDescription('Reset this channel to the gateway\'s default model'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('thinking')
      .setDescription('Set the default thinking level for this channel')
      .addStringOption((option) =>
        option
          .setName('level')
          .setDescription('Thinking level')
          .setRequired(true)
          .addChoices(
            { name: 'off', value: 'off' },
            { name: 'minimal', value: 'minimal' },
            { name: 'low', value: 'low' },
            { name: 'medium', value: 'medium' },
            { name: 'high', value: 'high' },
            { name: 'xhigh', value: 'xhigh' },
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('new')
      .setDescription('Start a fresh pi session for this channel'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('stop')
      .setDescription('Abort the current task and clear the queue for this channel'),
  )
