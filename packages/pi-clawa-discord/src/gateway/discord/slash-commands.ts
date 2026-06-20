import {
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type InteractionReplyOptions,
} from 'discord.js';
import { getChannelSessionStatus } from '../agent/invoke.js';
import { config } from '../config.js';
import {
  clearChannelModelOverride,
  clearPendingMessages,
  createDmChannel,
  getChannel,
  registerChannel,
  setChannelModelOverride,
  setChannelThinkingOverride,
} from '../db.js';
import { logger } from '../logger.js';
import {
  autocompleteModels,
  isThinkingLevel,
  listAvailableModels,
  resolveModelReference,
  resolveThinkingForModel,
  toModelChoiceName,
} from '../agent/model-catalog.js';
import {
  buildThinkingAdjustmentMessage,
  computeEffectiveChannelSettings,
  getDesiredThinkingLevel,
} from '../agent/channel-settings.js';
import { abortChannelTask, isChannelProcessing } from '../agent/queue.js';
import { rotateChannelSessionDir } from '../session/path.js';
import { PI_COMMAND } from './slash-schema.js';
import { buildStatusMessage } from './slash-status.js';
import type { RegisteredChannel } from '../types.js';

export async function registerGlobalCommands(client: Client<true>): Promise<void> {
  await client.application.commands.set([PI_COMMAND.toJSON()]);
  logger.info('Registered global slash commands');
}

export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (interaction.commandName !== 'pi') return;
  if (interaction.options.getSubcommand() !== 'model') return;
  if (interaction.options.getFocused(true).name !== 'model') return;

  const focused = interaction.options.getFocused();
  const matches = autocompleteModels(focused, 25).map((model) => ({
    name: toModelChoiceName(model),
    value: model.ref,
  }));

  await interaction.respond(matches);
}

export async function handleChatCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.commandName !== 'pi') return;

  const subcommand = interaction.options.getSubcommand();

  try {
    switch (subcommand) {
      case 'status':
        await handleStatus(interaction);
        return;
      case 'model':
        await handleModelSet(interaction);
        return;
      case 'reset-model':
        await handleModelReset(interaction);
        return;
      case 'thinking':
        await handleThinkingSet(interaction);
        return;
      case 'new':
        await handleNew(interaction);
        return;
      case 'stop':
        await handleStop(interaction);
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

async function handleNew(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = ensureManagedChannel(interaction);
  if (!channel) {
    await interaction.reply(reply(notRegisteredMessage(), interaction));
    return;
  }

  if (isChannelProcessing(channel.jid)) {
    await interaction.reply(reply(
      'This channel is currently processing a message. Wait for it to finish, then run /new again.',
      interaction,
    ));
    return;
  }

  const cleared = clearPendingMessages(channel.jid);
  const archivedSession = rotateChannelSessionDir(channel.folder);

  logger.info({ jid: channel.jid, cleared, archived: Boolean(archivedSession) }, 'Channel session reset');

  const notes = ['Started a fresh session for this channel.'];
  if (cleared > 0) {
    notes.push(`Cleared ${cleared} queued ${cleared === 1 ? 'message' : 'messages'}.`);
  }
  if (archivedSession) {
    notes.push('Archived the previous session on disk.');
  }

  await interaction.reply(reply(notes.join('\n'), interaction));
}

async function handleStop(interaction: ChatInputCommandInteraction): Promise<void> {
  const jid = `dc:${interaction.channelId}`;
  const result = abortChannelTask(jid);

  if (!result.aborted && result.cleared === 0) {
    await interaction.reply(reply('No active task or queued messages in this channel.', interaction));
    return;
  }

  const notes: string[] = [];
  if (result.aborted) {
    notes.push('Aborted the current task.');
  }
  if (result.cleared > 0) {
    notes.push(`Cleared ${result.cleared} queued ${result.cleared === 1 ? 'message' : 'messages'}.`);
  }

  await interaction.reply(reply(notes.join(' '), interaction));
}

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = ensureManagedChannel(interaction);
  if (!channel) {
    await interaction.reply(reply(notRegisteredMessage(), interaction));
    return;
  }

  await interaction.deferReply(interaction.inGuild() ? { flags: MessageFlags.Ephemeral } : undefined);

  const effective = computeEffectiveChannelSettings(channel);
  const sessionStatus = await getChannelSessionStatus(channel.folder, effective.effectiveCwd);
  await interaction.editReply({ content: buildStatusMessage(effective, sessionStatus) });
}

async function handleModelSet(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = ensureManagedChannel(interaction);
  if (!channel) {
    await interaction.reply(reply(notRegisteredMessage(), interaction));
    return;
  }

  const selectedRef = interaction.options.getString('model', true);
  const models = listAvailableModels({ forceRefresh: true });
  const selectedModel = resolveModelReference(selectedRef, models);
  if (!selectedModel) {
    await interaction.reply(reply(`Model is no longer available: ${selectedRef}`, interaction));
    return;
  }

  setChannelModelOverride(channel.jid, selectedModel.ref);

  // Re-read channel to use the persisted override in status/effective computation.
  const updated = getChannel(channel.jid)!;
  const desiredThinking = getDesiredThinkingLevel(updated);
  const thinkingResolution = resolveThinkingForModel(selectedModel, desiredThinking);

  // Only persist the clamped value if the channel already had an explicit thinking override.
  if (updated.thinkingOverride) {
    setChannelThinkingOverride(updated.jid, thinkingResolution.effective);
  }

  const notes = [`Model set to ${selectedModel.ref} for this channel.`];
  if (thinkingResolution.adjusted) {
    notes.push(buildThinkingAdjustmentMessage(thinkingResolution.requested, thinkingResolution.effective, selectedModel));
  }

  await interaction.reply(reply(notes.join('\n'), interaction));
}

async function handleModelReset(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = ensureManagedChannel(interaction);
  if (!channel) {
    await interaction.reply(reply(notRegisteredMessage(), interaction));
    return;
  }

  clearChannelModelOverride(channel.jid);

  const updated = getChannel(channel.jid)!;
  const effective = computeEffectiveChannelSettings(updated, { forceRefresh: true });
  const notes = ['Model reset for this channel.'];

  if (updated.thinkingOverride && effective.thinkingAdjusted) {
    setChannelThinkingOverride(updated.jid, effective.effectiveThinking);
  }

  if (effective.thinkingAdjusted) {
    const currentThinking = effective.hasManagedThinking ? effective.effectiveThinking : '(pi runtime default)';
    notes.push(`Current effective thinking is ${currentThinking}. ${effective.thinkingAdjustmentMessage}`);
  }

  await interaction.reply(reply(notes.join('\n'), interaction));
}

async function handleThinkingSet(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = ensureManagedChannel(interaction);
  if (!channel) {
    await interaction.reply(reply(notRegisteredMessage(), interaction));
    return;
  }

  const rawLevel = interaction.options.getString('level', true);
  if (!isThinkingLevel(rawLevel)) {
    await interaction.reply(reply(`Invalid thinking level: ${rawLevel}`, interaction));
    return;
  }

  const effective = computeEffectiveChannelSettings(channel, { forceRefresh: true });
  const resolution = resolveThinkingForModel(effective.modelInfo, rawLevel);

  setChannelThinkingOverride(channel.jid, resolution.effective);

  const notes = [`Thinking level set to ${resolution.effective} for this channel.`];
  if (resolution.adjusted) {
    notes.push(buildThinkingAdjustmentMessage(resolution.requested, resolution.effective, effective.modelInfo));
  }

  await interaction.reply(reply(notes.join('\n'), interaction));
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
