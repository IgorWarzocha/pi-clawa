/**
 * Discord channel adapter.
 *
 * Keeps gateway lifecycle and event wiring here. Inbound/outbound Discord IO lives
 * in sibling modules so channel policy, message shaping, and transport do not
 * pile up in the client entrypoint again.
 */

import {
	Client,
	Events,
	MessageFlags,
	Partials,
	type Interaction,
	type InteractionReplyOptions,
	type MessageReaction,
	type PartialMessageReaction,
	type PartialUser,
	type User,
} from "discord.js";
import { config } from "../config.js";
import { getChannel, logMessage } from "../db.js";
import { logger } from "../logger.js";
import { buildGatewayIntents } from "./presence.js";
import { buildReactionLogContent } from "./reaction-log.js";
import {
	handleAutocomplete,
	handleChatCommand,
	registerGlobalCommands,
} from "./slash-commands.js";
import { createMessageHandler } from "./inbound.js";
import {
	handleAskClawaCommand,
	handleDiscordButton,
	handleDiscordModal,
	handleDiscordSelect,
} from "./interactions.js";
import {
	reconcileDiscordMessageDelete,
	reconcileDiscordMessageUpdate,
} from "./message-lifecycle.js";
import {
	setTypingWithClient,
} from "./outbound.js";
import type {
	DiscordDeliveryRequest,
	DiscordDeliveryResult,
} from "../delivery-types.js";
import { sendDiscordDeliveryWithClient } from "./delivery-renderer.js";
import {
	buildTriggerAliasPattern,
	escapeRegExp,
	shouldAcceptTriggeredMessage,
	shouldIgnoreExcludedGuildChannel,
} from "./policy.js";

export { shouldAcceptTriggeredMessage, shouldIgnoreExcludedGuildChannel };

let client: Client | null = null;
let triggerPattern: RegExp;
let triggerAliasPattern: RegExp | null = null;
let botId: string;
let rejectDiscordStartup: ((error: Error) => void) | null = null;

export async function startDiscord(): Promise<void> {
	client = new Client({
		intents: buildGatewayIntents(),
		// Required for DM message events in discord.js.
		partials: [
			Partials.Channel,
			Partials.Message,
			Partials.Reaction,
			Partials.User,
		],
	});

	const handleMessage = createMessageHandler({
		getClient: () => client,
		getBotId: () => botId,
		getTriggerPattern: () => triggerPattern,
		getTriggerAliasPattern: () => triggerAliasPattern,
	});
	client.on(Events.MessageCreate, (message) => {
		runDiscordEvent("message create", () => handleMessage(message));
	});
	client.on(Events.MessageReactionAdd, (reaction, user) => {
		runDiscordEvent("reaction add", () => handleReactionEvent(reaction, user, "added"));
	});
	client.on(Events.MessageUpdate, (_oldMessage, newMessage) => {
		runDiscordEvent("message update", () => reconcileDiscordMessageUpdate(newMessage));
	});
	client.on(Events.MessageDelete, (message) => {
		runDiscordEvent("message delete", () => reconcileDiscordMessageDelete(message));
	});
	client.on(Events.MessageReactionRemove, (reaction, user) => {
		runDiscordEvent("reaction remove", () => handleReactionEvent(reaction, user, "removed"));
	});
	client.on(Events.InteractionCreate, (interaction) => {
		runDiscordEvent("interaction", () => handleInteraction(interaction));
	});
	client.on(Events.Error, (err) =>
		logger.error({ err: err.message }, "Discord client error"),
	);

	return new Promise<void>((resolve, reject) => {
		const onReady = async (ready: Client<true>) => {
			cleanup();
			botId = ready.user.id;
			triggerPattern = new RegExp(
				`^@${escapeRegExp(config.triggerName)}\\b`,
				"i",
			);
			triggerAliasPattern = buildTriggerAliasPattern(config.triggerAliases);
			logger.info({ tag: ready.user.tag, id: botId }, "Discord bot connected");

			try {
				await registerGlobalCommands(ready);
			} catch (err: any) {
				logger.error(
					{ err: err.message },
					"Failed to register global slash commands",
				);
			}

			resolve();
		};

		const onStartupError = (err: Error) => {
			cleanup();
			reject(err);
		};

		const cleanup = () => {
			if (rejectDiscordStartup === onStartupError) rejectDiscordStartup = null;
			client?.off(Events.ClientReady, onReady);
			client?.off(Events.Error, onStartupError);
		};

		rejectDiscordStartup = onStartupError;
		client!.once(Events.ClientReady, onReady);
		client!.once(Events.Error, onStartupError);
		client!.login(config.discordToken).catch(onStartupError);
	});
}

function runDiscordEvent(name: string, handler: () => void | Promise<void>): void {
	Promise.resolve()
		.then(handler)
		.catch((error: unknown) => {
			logger.error(
				{ event: name, err: error instanceof Error ? error.message : String(error) },
				"Discord event handler failed",
			);
		});
}

async function handleInteraction(interaction: Interaction): Promise<void> {
	try {
		if (interaction.isAutocomplete()) {
			await handleAutocomplete(interaction);
			return;
		}

		if (interaction.isChatInputCommand()) {
			await handleChatCommand(interaction);
			return;
		}

		if (interaction.isMessageContextMenuCommand()) {
			await handleAskClawaCommand(interaction);
			return;
		}

		if (interaction.isButton()) {
			await handleDiscordButton(interaction);
			return;
		}

		if (interaction.isStringSelectMenu()) {
			await handleDiscordSelect(interaction);
			return;
		}

		if (interaction.isModalSubmit()) {
			await handleDiscordModal(interaction);
		}
	} catch (err: any) {
		logger.error(
			{ err: err.message, id: interaction.id },
			"Interaction handler failed",
		);
		await reportInteractionFailure(interaction).catch((replyError: unknown) => {
			logger.warn(
				{ err: replyError instanceof Error ? replyError.message : String(replyError) },
				"Could not report Discord interaction failure",
			);
		});
	}
}

async function reportInteractionFailure(interaction: Interaction): Promise<void> {
	if (!interaction.isRepliable()) return;
	const payload: InteractionReplyOptions = {
		content: "Clawa could not handle that Discord action. Please try again.",
		...(interaction.inGuild() ? { flags: MessageFlags.Ephemeral } : {}),
	};
	if (interaction.replied || interaction.deferred) {
		await interaction.followUp(payload);
		return;
	}
	await interaction.reply(payload);
}

async function handleReactionEvent(
	reaction: MessageReaction | PartialMessageReaction,
	user: User | PartialUser,
	action: "added" | "removed",
): Promise<void> {
	if (user.bot) return;

	try {
		if (reaction.partial) {
			await reaction.fetch();
		}

		if (reaction.message.partial) {
			await reaction.message.fetch();
		}

		if (
			shouldIgnoreExcludedGuildChannel(reaction.message.channelId, {
				isDM: !reaction.message.guild,
				excludedChannels: config.excludedChannels,
			})
		) {
			return;
		}

		const jid = `dc:${reaction.message.channelId}`;
		if (!getChannel(jid)) {
			return;
		}

		const senderName =
			reaction.message.guild?.members.cache.get(user.id)?.displayName ||
			user.displayName ||
			user.username ||
			"Unknown user";
		const targetAuthor =
			reaction.message.member?.displayName ||
			reaction.message.author?.displayName ||
			reaction.message.author?.username ||
			"someone";

		logMessage({
			channelJid: jid,
			role: "reaction",
			senderId: user.id,
			senderName,
			content: buildReactionLogContent({
				action,
				emoji: reaction.emoji.toString(),
				targetAuthor,
				messageContent: reaction.message.content ?? "",
			}),
			timestamp: new Date().toISOString(),
		});
	} catch (err: any) {
		logger.warn({ err: err.message }, "Failed to log Discord reaction event");
	}
}

export async function setTyping(jid: string): Promise<void> {
	return setTypingWithClient(client, jid);
}

export async function sendDelivery(
	request: DiscordDeliveryRequest,
	nonce: string,
): Promise<DiscordDeliveryResult> {
	return await sendDiscordDeliveryWithClient(client, request, nonce);
}

export function stopDiscord(): void {
	rejectDiscordStartup?.(new Error("Discord startup was stopped"));
	if (client) {
		client.destroy();
		client = null;
		logger.info("Discord bot stopped");
	}
}

export function getBotTag(): string | undefined {
	return client?.user?.tag;
}
