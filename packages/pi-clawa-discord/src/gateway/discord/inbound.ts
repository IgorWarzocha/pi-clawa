import { type Client, type Message, type TextChannel } from "discord.js";
import type { RegisteredChannel } from "../types.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import {
	createDmChannel,
	getChannel,
	getLoggedSourceMessageRowId,
	registerChannel as dbRegisterChannel,
	enqueueMessage,
	logMessage,
} from "../db.js";
import {
	appendDiscordReferences,
	appendDiscordLinksIndex,
	buildAttachmentOnlyPrompt,
	buildLinkMetas,
	cacheDiscordAttachments,
	selectAttachmentsWithinLimits,
	type AttachmentMeta,
	type LinkMeta,
} from "./attachments.js";
import { buildGuildPresenceContext } from "./presence.js";
import { formatDiscordReplyContext, readDiscordReplyContext } from "./reply-context.js";
import {
	shouldAcceptTriggeredMessage,
	shouldIgnoreExcludedGuildChannel,
	stripAcceptedTrigger,
} from "./policy.js";
import { sanitizeDiscordLabel, sanitizeDiscordText } from "./sanitize.js";

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
	let content = sanitizeDiscordText(message.content);
	const senderName =
		sanitizeDiscordLabel(
			message.member?.displayName ||
				message.author.displayName ||
				message.author.username,
		) || message.author.id;
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
				name: sanitizeDiscordLabel(att.name || "file") || "file",
				contentType: sanitizeDiscordLabel(att.contentType || ""),
				size: att.size || 0,
			}),
		);

		const selection = selectAttachmentsWithinLimits(metas, {
			maxFileBytes: config.maxAttachmentBytes,
			maxTotalBytes: config.maxTotalAttachmentBytes,
		});

		acceptedAttachments = await cacheDiscordAttachments(message.id, message.createdAt, selection.accepted);
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

	const reply = await readDiscordReplyContext(message, botId);
	const replyContext = formatDiscordReplyContext(reply.entries);

	let observedContent = reply.immediateAuthor
		? `[Reply to ${reply.immediateAuthor}] ${content}`.trim()
		: content.trim();
	if (!observedContent && acceptedAttachments.length > 0) {
		observedContent = buildAttachmentOnlyPrompt(acceptedAttachments.length);
	}
	const observedLinks: LinkMeta[] = buildLinkMetas(observedContent, message.embeds);
	observedContent = appendDiscordReferences(
		observedContent,
		acceptedAttachments,
		observedLinks,
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
			requiresTrigger: config.channelPolicy === "open-trigger",
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

	let observedLogRowId = getLoggedSourceMessageRowId(jid, "user", message.id) ?? null;
	if (observedLogRowId) {
		logger.debug(
			{ jid, sourceMessageId: message.id },
			"Replayed Discord message found in observation log",
		);
	} else {
		await appendDiscordLinksIndex({
			createdAt: message.createdAt,
			senderName,
			channelName: channel.name,
			links: observedLinks,
		});

		if (observedContent) {
			observedLogRowId = logMessage({
				channelJid: jid,
				role: "user",
				senderId: sender,
				senderName,
				sourceMessageId: message.id,
				content: observedContent,
				timestamp,
			});
		}
	}

	const isDirected = shouldAcceptTriggeredMessage(content, {
		requiresTrigger: channel.requiresTrigger,
		isReplyToBot: reply.isReplyToBot,
		triggerPattern,
		triggerAliasPattern,
	});

	// ── Trigger check ──
	if (!isDirected) {
		logger.debug({ jid }, "Message does not match trigger, ignoring");
		return;
	}

	// Strip trigger prefix from content sent to agent
	content = stripAcceptedTrigger(content, {
		triggerPattern,
		triggerAliasPattern,
		stripAlias: channel.requiresTrigger,
	});
	if (!content && acceptedAttachments.length > 0) {
		content = buildAttachmentOnlyPrompt(acceptedAttachments.length);
	}
	const promptLinks = buildLinkMetas(content, message.embeds);
	content = appendDiscordReferences(content, acceptedAttachments, promptLinks);
	if (!content) return;

	const presenceContext = await buildGuildPresenceContext(message);
	if (presenceContext) {
		content = `${presenceContext}\n${content}`;
	}

	// ── Enqueue ──
	const enqueued = enqueueMessage({
		channelJid: jid,
		sender,
		senderName,
		sourceMessageId: message.id,
		replyToMessageId: message.id,
		replyContext,
		logRowId: observedLogRowId,
		content,
		timestamp,
		attachments: attachmentsJson,
	});
	if (!enqueued) {
		logger.debug(
			{ jid, sourceMessageId: message.id },
			"Duplicate Discord message ignored at queue boundary",
		);
		return;
	}
	logger.info(
		{ jid, sender: senderName, len: content.length },
		"Message enqueued",
	);
}
}
