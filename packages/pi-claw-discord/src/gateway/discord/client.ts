/**
 * Discord channel adapter.
 *
 * Architecture borrowed from NanoClaw (https://github.com/qwibitai/nanoclaw).
 * Handles all Discord I/O: receiving messages, sending responses, typing indicators.
 * Contains zero business logic — that lives in the pi agent.
 */

import {
	Client,
	Events,
	PermissionFlagsBits,
	Partials,
	type Interaction,
	type Message,
	type MessageReaction,
	type PartialMessageReaction,
	type PartialUser,
	type TextChannel,
	type DMChannel,
	type User,
} from "discord.js";
import { type RegisteredChannel } from "../types.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import {
	noteAmbientObservedMessage,
	createDmChannel,
	getChannel,
	registerChannel as dbRegisterChannel,
	enqueueMessage,
	logMessage,
} from "../db.js";
import { AMBIENT_SENDER, buildAmbientPrompt } from "../agent/ambient.js";
import {
	appendAttachmentReferences,
	buildAttachmentOnlyPrompt,
	selectAttachmentsWithinLimits,
	type AttachmentMeta,
} from "./attachments.js";
import { buildGatewayIntents, buildGuildPresenceContext } from "./presence.js";
import { replacePlainUserMentions, type MentionCandidate } from "./mentions.js";
import { buildReactionLogContent } from "./reaction-log.js";
import {
	handleAutocomplete,
	handleChatCommand,
	registerGlobalCommands,
} from "./slash-commands.js";

let client: Client | null = null;
let triggerPattern: RegExp;
let triggerAliasPattern: RegExp | null = null;
let botId: string;

export function shouldAcceptTriggeredMessage(
	content: string,
	opts: {
		requiresTrigger: boolean;
		isReplyToBot: boolean;
		triggerPattern: RegExp;
		triggerAliasPattern?: RegExp | null;
	},
): boolean {
	if (!opts.requiresTrigger) return true;
	if (opts.isReplyToBot) return true;
	if (opts.triggerAliasPattern?.test(content)) return true;
	return opts.triggerPattern.test(content);
}

export function shouldIgnoreExcludedGuildChannel(
	channelId: string,
	opts: { isDM: boolean; excludedChannels: ReadonlySet<string> },
): boolean {
	return !opts.isDM && opts.excludedChannels.has(channelId);
}

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

	client.on(Events.MessageCreate, handleMessage);
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

async function handleMessage(message: Message): Promise<void> {
	// Ignore bot messages
	if (message.author.bot) return;

	const isDM = !message.guild;
	const channelId = message.channelId;
	const jid = `dc:${channelId}`;

	// Exclusions are a hard safety rail, not just an auto-registration hint.
	// A channel may already be registered from an earlier open-trigger policy;
	// if it is later excluded, do not observe, log, enqueue, or reply there.
	if (
		shouldIgnoreExcludedGuildChannel(channelId, {
			isDM,
			excludedChannels: config.excludedChannels,
		})
	) {
		logger.debug({ jid }, "Message from excluded channel, ignoring");
		return;
	}

	// ── Build content ──
	let content = message.content;
	const senderName =
		message.member?.displayName ||
		message.author.displayName ||
		message.author.username;
	const sender = message.author.id;
	const timestamp = message.createdAt.toISOString();

	// Translate @bot mentions → trigger format
	if (client?.user) {
		const isMentioned =
			message.mentions.users.has(botId) ||
			content.includes(`<@${botId}>`) ||
			content.includes(`<@!${botId}>`);

		if (isMentioned) {
			content = content.replace(new RegExp(`<@!?${botId}>`, "g"), "").trim();
			if (!triggerPattern.test(content)) {
				content = `@${config.triggerName} ${content}`;
			}
		}
	}

	// Attachments → extract metadata for downstream download
	let acceptedAttachments: AttachmentMeta[] = [];
	let attachmentsJson: string | null = null;
	if (message.attachments.size > 0) {
		const metas: AttachmentMeta[] = [...message.attachments.values()].map(
			(att) => ({
				url: att.url,
				name: att.name || "file",
				contentType: att.contentType || "",
				size: att.size || 0,
			}),
		);

		const selection = selectAttachmentsWithinLimits(metas, {
			maxFileBytes: config.maxAttachmentBytes,
			maxTotalBytes: config.maxTotalAttachmentBytes,
		});

		acceptedAttachments = selection.accepted;
		if (selection.rejected.length > 0) {
			logger.info(
				{
					jid,
					skipped: selection.rejected.map(
						({ attachment, reason, limitBytes }) => ({
							name: attachment.name,
							size: attachment.size,
							reason,
							limitBytes,
						}),
					),
				},
				"Skipped oversized Discord attachments before enqueue",
			);
		}

		if (acceptedAttachments.length > 0) {
			attachmentsJson = JSON.stringify(acceptedAttachments);
		}
	}

	// Reply context
	let isReplyToBot = false;
	if (message.reference?.messageId) {
		try {
			const ref = await message.channel.messages.fetch(
				message.reference.messageId,
			);
			isReplyToBot = ref.author.id === botId;
			const refAuthor =
				ref.member?.displayName ||
				ref.author.displayName ||
				ref.author.username;
			content = `[Reply to ${refAuthor}] ${content}`;
		} catch {
			// deleted message
		}
	}

	let observedContent = content.trim();
	if (!observedContent && acceptedAttachments.length > 0) {
		observedContent = buildAttachmentOnlyPrompt(acceptedAttachments.length);
	}
	observedContent = appendAttachmentReferences(
		observedContent,
		acceptedAttachments,
	);

	// ── Channel registration check ──
	let channel = getChannel(jid);

	// Auto-register DMs
	if (!channel && isDM && config.autoRegisterDMs) {
		const reg = createDmChannel(jid, sender, senderName);
		dbRegisterChannel(reg);
		channel = reg;
		logger.info({ jid, senderName }, "Auto-registered DM channel");
	}

	// Auto-register guild channels based on policy
	if (!channel && !isDM && config.channelPolicy !== "allowlist") {
		if (config.excludedChannels.has(channelId)) {
			return;
		}

		const guildName = message.guild?.name || "Unknown";
		const channelName = (message.channel as TextChannel).name || "unknown";
		const name = `${guildName} #${channelName}`;
		const reg: RegisteredChannel = {
			jid,
			name,
			folder: `ch_${channelId}`,
			requiresTrigger: config.channelPolicy === "open-trigger",
			isMain: false,
			modelOverride: "",
			thinkingOverride: "",
			cwdOverride: "",
		};
		dbRegisterChannel(reg);
		channel = reg;
		logger.info(
			{ jid, name, policy: config.channelPolicy },
			"Auto-registered guild channel",
		);
	}

	if (!channel) {
		logger.debug({ jid }, "Message from unregistered channel, ignoring");
		return;
	}

	let observedLogRowId: number | null = null;
	if (observedContent) {
		observedLogRowId = logMessage({
			channelJid: jid,
			role: "user",
			senderId: sender,
			senderName,
			content: observedContent,
			timestamp,
		});
	}

	const isDirected = shouldAcceptTriggeredMessage(content, {
		requiresTrigger: channel.requiresTrigger,
		isReplyToBot,
		triggerPattern,
		triggerAliasPattern,
	});

	// ── Trigger check ──
	if (!isDirected) {
		if (!isDM && shouldUseAmbientJitter(channelId) && observedContent) {
			const shouldChime = noteAmbientObservedMessage(jid, {
				now: timestamp,
				minMessages: config.ambientJitterMinMessages,
				maxMessages: Math.max(
					config.ambientJitterMinMessages,
					config.ambientJitterMaxMessages,
				),
				cooldownSeconds: config.ambientJitterCooldownSeconds,
				random: Math.random,
			});

			if (shouldChime) {
				enqueueMessage({
					channelJid: jid,
					sender: AMBIENT_SENDER,
					senderName: "Ambient",
					sourceMessageId: message.id,
					logRowId: observedLogRowId,
					content: buildAmbientPrompt(),
					timestamp,
				});
				logger.info({ jid }, "Ambient jitter prompt enqueued");
			}
		}

		logger.debug({ jid }, "Message does not match trigger, ignoring");
		return;
	}

	// Strip trigger prefix from content sent to agent
	content = content.replace(triggerPattern, "").trim();
	if (!content && acceptedAttachments.length > 0) {
		content = buildAttachmentOnlyPrompt(acceptedAttachments.length);
	}
	content = appendAttachmentReferences(content, acceptedAttachments);
	if (!content) return;

	const presenceContext = await buildGuildPresenceContext(message);
	if (presenceContext) {
		content = `${presenceContext}\n${content}`;
	}

	// ── Enqueue ──
	enqueueMessage({
		channelJid: jid,
		sender,
		senderName,
		sourceMessageId: message.id,
		logRowId: observedLogRowId,
		content,
		timestamp,
		attachments: attachmentsJson,
	});
	logger.info(
		{ jid, sender: senderName, len: content.length },
		"Message enqueued",
	);
}

function shouldUseAmbientJitter(channelId: string): boolean {
	return config.ambientJitterChannels.has(channelId);
}

function buildTriggerAliasPattern(aliases: string[]): RegExp | null {
	if (aliases.length === 0) return null;
	const parts = aliases
		.map((alias) => escapeRegExp(alias))
		.filter(Boolean)
		.map((alias) => `${alias}\\w*`);
	if (parts.length === 0) return null;
	return new RegExp(`\\b(?:${parts.join("|")})\\b`, "i");
}

// ── Outbound ──

const DISCORD_MAX_LENGTH = 2000;

export async function sendResponse(
	jid: string,
	text: string,
	options: { replyToMessageId?: string | null } = {},
): Promise<boolean> {
	if (!client) return false;

	const channelId = jid.replace(/^dc:/, "");

	try {
		const channel = await client.channels.fetch(channelId);
		if (!channel || !("send" in channel)) {
			logger.warn({ jid }, "Channel not found or not text-based");
			return false;
		}

		const textChannel = channel as TextChannel | DMChannel;
		const resolvedText = await resolveOutgoingMentions(textChannel, text);
		const sendOptions = {
			allowedMentions: {
				parse: ["users" as const],
				repliedUser: false,
			},
			...(options.replyToMessageId
				? {
						reply: {
							messageReference: options.replyToMessageId,
							failIfNotExists: false,
						},
					}
				: {}),
		};

		if (resolvedText.length <= DISCORD_MAX_LENGTH) {
			await textChannel.send({ content: resolvedText, ...sendOptions });
		} else {
			// Split at line boundaries when possible
			const chunks = splitMessage(resolvedText, DISCORD_MAX_LENGTH);
			for (const [index, chunk] of chunks.entries()) {
				await textChannel.send({
					content: chunk,
					...(index === 0
						? sendOptions
						: {
								allowedMentions: sendOptions.allowedMentions,
							}),
				});
			}
		}
		logger.info({ jid, length: resolvedText.length }, "Response sent");
		return true;
	} catch (err: any) {
		logger.error({ jid, err: err.message }, "Failed to send message");
		return false;
	}
}

async function resolveOutgoingMentions(
	channel: TextChannel | DMChannel,
	text: string,
): Promise<string> {
	if (!("guild" in channel)) return text;

	const candidates = await listVisibleMentionCandidates(channel);
	if (candidates.length === 0) return text;

	return replacePlainUserMentions(text, candidates);
}

async function listVisibleMentionCandidates(
	channel: TextChannel,
): Promise<MentionCandidate[]> {
	try {
		const members = [...channel.guild.members.cache.values()]
			.filter((member) => !member.user.bot)
			.filter((member) =>
				channel.permissionsFor(member).has(PermissionFlagsBits.ViewChannel),
			);

		return members.map((member) => ({
			id: member.id,
			names: [
				member.displayName,
				member.user.globalName ?? "",
				member.user.username,
			],
		}));
	} catch {
		return [];
	}
}

export async function setTyping(jid: string): Promise<void> {
	if (!client) return;
	try {
		const channelId = jid.replace(/^dc:/, "");
		const channel = await client.channels.fetch(channelId);
		if (channel && "sendTyping" in channel) {
			await (channel as TextChannel).sendTyping();
		}
	} catch {
		// best-effort
	}
}

export async function addReaction(
	jid: string,
	messageId: string,
	emoji: string,
): Promise<boolean> {
	if (!client) return false;

	try {
		const channelId = jid.replace(/^dc:/, "");
		const channel = await client.channels.fetch(channelId);
		if (!channel || !("messages" in channel)) {
			logger.warn(
				{ jid, messageId },
				"Channel not found or does not support reactions",
			);
			return false;
		}

		const message = await (channel as TextChannel | DMChannel).messages.fetch(
			messageId,
		);
		await message.react(emoji);
		logger.info({ jid, messageId, emoji }, "Reaction added");
		return true;
	} catch (err: any) {
		logger.warn(
			{ jid, messageId, emoji, err: err.message },
			"Failed to add reaction",
		);
		return false;
	}
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

// ── Helpers ──

function splitMessage(text: string, max: number): string[] {
	const chunks: string[] = [];
	let remaining = text;

	while (remaining.length > max) {
		// Try to split at last newline within limit
		let splitAt = remaining.lastIndexOf("\n", max);
		if (splitAt <= 0) splitAt = max; // hard split if no newline
		chunks.push(remaining.slice(0, splitAt));
		remaining = remaining.slice(splitAt).replace(/^\n/, "");
	}
	if (remaining) chunks.push(remaining);
	return chunks;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
