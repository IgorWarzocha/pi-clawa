import type { Message, PartialMessage } from "discord.js";
import { config } from "../config.js";
import {
	deletePendingDiscordMessage,
	getChannel,
	markLoggedDiscordMessageDeleted,
	updateLoggedDiscordMessage,
	updatePendingDiscordMessage,
} from "../db.js";
import { logger } from "../logger.js";
import {
	appendDiscordReferences,
	buildAttachmentOnlyPrompt,
	buildLinkMetas,
	cacheDiscordAttachments,
	selectAttachmentsWithinLimits,
	type AttachmentMeta,
} from "./attachments.js";
import { shouldIgnoreExcludedGuildChannel } from "./policy.js";
import { sanitizeDiscordLabel, sanitizeDiscordText } from "./sanitize.js";

export async function reconcileDiscordMessageUpdate(
	partial: Message | PartialMessage,
): Promise<void> {
	try {
		const message = partial.partial ? await partial.fetch() : partial;
		if (!message.author || message.author.bot) return;
		const jid = `dc:${message.channelId}`;
		if (!getChannel(jid)) return;
		if (
			shouldIgnoreExcludedGuildChannel(message.channelId, {
				isDM: !message.guild,
				excludedChannels: config.excludedChannels,
			})
		) {
			return;
		}

		const attachments = await cacheEditedAttachments(message);
		let content = sanitizeDiscordText(message.content).trim();
		if (!content && attachments.length > 0) {
			content = buildAttachmentOnlyPrompt(attachments.length);
		}
		content = appendDiscordReferences(content, attachments, buildLinkMetas(content, message.embeds));
		if (!content) content = "[Empty Discord message]";

		const updatedLog = updateLoggedDiscordMessage(jid, message.id, content);
		const updatedQueue = updatePendingDiscordMessage(jid, message.id, content);
		if (updatedLog || updatedQueue) {
			logger.info({ jid, messageId: message.id }, "Reconciled edited Discord message");
		}
	} catch (error) {
		logger.warn(
			{ err: error instanceof Error ? error.message : String(error) },
			"Failed to reconcile edited Discord message",
		);
	}
}

export function reconcileDiscordMessageDelete(partial: Message | PartialMessage): void {
	const jid = `dc:${partial.channelId}`;
	if (!getChannel(jid)) return;
	const updated = markLoggedDiscordMessageDeleted(jid, partial.id);
	const removed = deletePendingDiscordMessage(jid, partial.id);
	if (updated || removed) {
		logger.info({ jid, messageId: partial.id, removedPending: removed }, "Reconciled deleted Discord message");
	}
}

async function cacheEditedAttachments(message: Message): Promise<AttachmentMeta[]> {
	if (message.attachments.size === 0) return [];
	const metas: AttachmentMeta[] = [...message.attachments.values()].map((attachment) => ({
		url: attachment.url,
		name: sanitizeDiscordLabel(attachment.name || "file") || "file",
		contentType: sanitizeDiscordLabel(attachment.contentType || ""),
		size: attachment.size || 0,
	}));
	const selected = selectAttachmentsWithinLimits(metas, {
		maxFileBytes: config.maxAttachmentBytes,
		maxTotalBytes: config.maxTotalAttachmentBytes,
	});
	return await cacheDiscordAttachments(message.id, message.createdAt, selected.accepted);
}
