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
	Partials,
	type Interaction,
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
	addReactionWithClient,
	sendResponseWithClient,
	setTypingWithClient,
} from "./outbound.js";
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

	client.on(
		Events.MessageCreate,
		createMessageHandler({
			getClient: () => client,
			getBotId: () => botId,
			getTriggerPattern: () => triggerPattern,
			getTriggerAliasPattern: () => triggerAliasPattern,
		}),
	);
	client.on(Events.MessageReactionAdd, (reaction, user) => {
		void handleReactionEvent(reaction, user, "added");
	});
	client.on(Events.MessageReactionRemove, (reaction, user) => {
		void handleReactionEvent(reaction, user, "removed");
	});
	client.on(Events.InteractionCreate, handleInteraction);
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
			client?.off(Events.ClientReady, onReady);
			client?.off(Events.Error, onStartupError);
		};

		client!.once(Events.ClientReady, onReady);
		client!.once(Events.Error, onStartupError);
		client!.login(config.discordToken).catch(onStartupError);
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
		}
	} catch (err: any) {
		logger.error(
			{ err: err.message, id: interaction.id },
			"Interaction handler failed",
		);
	}
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

export async function sendResponse(
	jid: string,
	text: string,
	options: { replyToMessageId?: string | null } = {},
): Promise<boolean> {
	return sendResponseWithClient(client, jid, text, options);
}

export async function setTyping(jid: string): Promise<void> {
	return setTypingWithClient(client, jid);
}

export async function addReaction(
	jid: string,
	messageId: string,
	emoji: string,
): Promise<boolean> {
	return addReactionWithClient(client, jid, messageId, emoji);
}

export function stopDiscord(): void {
	if (client) {
		client.destroy();
		client = null;
		logger.info("Discord bot stopped");
	}
}

export function getBotTag(): string | undefined {
	return client?.user?.tag;
}
