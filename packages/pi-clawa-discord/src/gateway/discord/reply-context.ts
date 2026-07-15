import type { Message } from "discord.js";
import { sanitizeDiscordLabel, sanitizeDiscordText } from "./sanitize.js";

const MAX_REPLY_DEPTH = 4;
const MAX_REPLY_BODY_LENGTH = 360;

export interface DiscordReplyContextEntry {
	messageId: string;
	senderName: string;
	content: string;
}

export interface DiscordReplyContext {
	isReplyToBot: boolean;
	immediateAuthor?: string | undefined;
	entries: DiscordReplyContextEntry[];
}

export async function readDiscordReplyContext(
	message: Message,
	botId: string,
): Promise<DiscordReplyContext> {
	const entries: DiscordReplyContextEntry[] = [];
	const seen = new Set<string>([message.id]);
	let reference = message.reference;
	let isReplyToBot = false;
	let immediateAuthor: string | undefined;

	while (reference?.messageId && entries.length < MAX_REPLY_DEPTH) {
		if (reference.channelId && reference.channelId !== message.channelId) break;
		if (seen.has(reference.messageId)) break;
		seen.add(reference.messageId);

		let parent: Message;
		try {
			parent = await message.channel.messages.fetch(reference.messageId);
		} catch {
			break;
		}

		const senderName = discordReplyAuthor(parent);
		if (entries.length === 0) {
			isReplyToBot = parent.author.id === botId;
			immediateAuthor = senderName;
		}
		entries.push({
			messageId: parent.id,
			senderName,
			content: discordReplyBody(parent),
		});
		reference = parent.reference;
	}

	entries.reverse();
	return { isReplyToBot, immediateAuthor, entries };
}

export function formatDiscordReplyContext(entries: DiscordReplyContextEntry[]): string {
	if (entries.length === 0) return "";
	return [
		"Reply context (oldest → newest):",
		...entries.map((entry) => `- ${entry.senderName}: ${entry.content}`),
	].join("\n");
}

function discordReplyAuthor(message: Message): string {
	return (
		sanitizeDiscordLabel(
			message.member?.displayName ||
				message.author.displayName ||
				message.author.username,
		) || message.author.id
	);
}

function discordReplyBody(message: Message): string {
	const text = sanitizeDiscordText(message.content).replace(/\s+/gu, " ").trim();
	const attachments = [...message.attachments.values()]
		.slice(0, 3)
		.map((attachment) =>
			sanitizeDiscordLabel(attachment.name || attachment.contentType || "attachment"),
		)
		.filter(Boolean);
	const body = [
		text,
		attachments.length > 0 ? `[attached: ${attachments.join(", ")}]` : "",
	]
		.filter(Boolean)
		.join(" ");
	return truncateReplyBody(body || "[message without text]", MAX_REPLY_BODY_LENGTH);
}

function truncateReplyBody(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}
