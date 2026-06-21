import {
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type InteractionReplyOptions,
} from 'discord.js';
import { getMappedClawaStatus } from '../agent/clawa-status.js';
import { resolveClawaWorkerForDiscordChannel } from '../channel-routes.js';
import { config } from '../config.js';
import { createDmChannel, getChannel, registerChannel } from '../db.js';
import { logger } from '../logger.js';
import type { RegisteredChannel } from '../types.js';
import { PI_COMMAND } from './slash-schema.js';
import { buildClawaStatusMessage } from './slash-status.js';

export async function registerGlobalCommands(client: Client<true>): Promise<void> {
  await client.application.commands.set([PI_COMMAND.toJSON()]);
  logger.info('Registered global slash commands');
}

export async function handleAutocomplete(_interaction: AutocompleteInteraction): Promise<void> {
  // No autocomplete-backed Discord commands remain in the Clawa-native adapter.
}

export async function handleChatCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.commandName !== 'pi') return;

  const subcommand = interaction.options.getSubcommand();

  try {
    switch (subcommand) {
      case 'status':
        await handleStatus(interaction);
        return;
      default:
        await interaction.reply(reply(`Unknown subcommand: ${subcommand}`, interaction));
    }
  } catch (err: any) {
    logger.error({ err: err.message, command: interaction.commandName, subcommand }, 'Slash command failed');
    const payload = reply(`⚠️ ${err.message}`, interaction);
    if (interaction.replied) {
      await interaction.followUp(payload);
    } else if (interaction.deferred) {
      await interaction.editReply({ content: payload.content ?? '' });
    } else {
      await interaction.reply(payload);
    }
  }
}

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = ensureManagedChannel(interaction);
  if (!channel) {
    await interaction.reply(reply(notRegisteredMessage(), interaction));
    return;
  }

  await interaction.deferReply(interaction.inGuild() ? { flags: MessageFlags.Ephemeral } : undefined);

  const mappedWorker = resolveClawaWorkerForDiscordChannel(channel.jid);
  if (mappedWorker) {
    const status = await getMappedClawaStatus(mappedWorker);
    await interaction.editReply({ content: buildClawaStatusMessage(status) });
    return;
  }

  await interaction.editReply({ content: 'This Discord channel is known, but it is not routed to a Clawa yet.' });
}

function ensureManagedChannel(interaction: ChatInputCommandInteraction): RegisteredChannel | undefined {
  const jid = `dc:${interaction.channelId}`;
  let channel = getChannel(jid);
  if (channel) return channel;

  // Allow slash commands to bootstrap DM channels, same as normal DM messages.
  if (!interaction.guild && config.autoRegisterDMs) {
    const reg = createDmChannel(jid, interaction.user.id, interaction.user.username);
    registerChannel(reg);
    return getChannel(jid) ?? reg;
  }

  return undefined;
}

function notRegisteredMessage(): string {
  return 'This channel is not registered yet. Send a regular message in this channel first — the gateway will auto-register it (if channel policy is `open` or `open-trigger`).';
}

function reply(content: string, interaction: ChatInputCommandInteraction): InteractionReplyOptions {
  if (interaction.inGuild()) {
    return { content, flags: MessageFlags.Ephemeral };
  }
  return { content };
}
