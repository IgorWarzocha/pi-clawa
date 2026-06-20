import { type Client, type Message, type TextChannel } from "discord.js";
import type { RegisteredChannel } from "../types.js";
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
import { buildGuildPresenceContext } from "./presence.js";
import {
	shouldAcceptTriggeredMessage,
	shouldIgnoreExcludedGuildChannel,
} from "./policy.js";

export interface MessageHandlerState {
	getClient(): Client | null;
	getBotId(): string;
	getTriggerPattern(): RegExp;
	getTriggerAliasPattern(): RegExp | null;
}

export function createMessageHandler(
	state: MessageHandlerState,
): (message: Message) => Promise<void> {
	return async function handleMessage(message: Message): Promise<void> {
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

	const botId = state.getBotId();
	const triggerPattern = state.getTriggerPattern();
	const triggerAliasPattern = state.getTriggerAliasPattern();

	// Translate @bot mentions → trigger format
	if (state.getClient()?.user) {
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


}

function shouldUseAmbientJitter(channelId: string): boolean {
	return config.ambientJitterChannels.has(channelId);
}
