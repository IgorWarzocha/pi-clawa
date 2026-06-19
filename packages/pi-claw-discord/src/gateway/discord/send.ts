import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { AttachmentBuilder, Client, GatewayIntentBits } from "discord.js";
import { config } from "../config.js";
import { extractDiscordDirectives } from "../agent/discord-directives.js";

export const NOTHING_FOR_DISCORD_SENTINEL = "[nothing_for_discord]";

export interface SendRequest {
	channelJid: string;
	text?: string;
	replyToMessageId?: string;
	files: string[];
}

export interface PreparedSendText {
	text?: string;
	reaction: string | null;
}

export function isNothingForDiscord(text?: string): boolean {
	return text?.toLowerCase().includes(NOTHING_FOR_DISCORD_SENTINEL) ?? false;
}

export function normalizeSendText(text?: string): string | undefined {
	const trimmed = text?.trim();
	if (!trimmed) {
		return undefined;
	}

	if (isNothingForDiscord(trimmed)) {
		return undefined;
	}

	return trimmed;
}

export function prepareSendText(text?: string): PreparedSendText {
	const trimmed = text?.trim();
	if (!trimmed) {
		return { text: undefined, reaction: null };
	}

	const parsed = extractDiscordDirectives(trimmed);
	return {
		text: normalizeSendText(parsed.text),
		reaction: parsed.reaction,
	};
}

export function normalizeChannelJid(input: string): string {
	const value = input.trim();
	return value.startsWith("dc:") ? value : `dc:${value}`;
}

export function validateSendRequest(
	request: SendRequest,
	options: {
		maxAttachmentBytes: number;
		fileStat: (path: string) => { size: number };
	},
): void {
	const prepared = prepareSendText(request.text);
	const hasText = Boolean(prepared.text);
	const isExplicitNoop = isNothingForDiscord(request.text);
	const hasReactionDirective = Boolean(prepared.reaction);

	if (
		!hasText &&
		request.files.length === 0 &&
		!isExplicitNoop &&
		!hasReactionDirective
	) {
		throw new Error("Either text or at least one file is required.");
	}

	if (request.files.length > 10) {
		throw new Error("At most 10 files can be sent in a single message.");
	}

	for (const filePath of request.files) {
		let file;

		try {
			file = options.fileStat(filePath);
		} catch {
			throw new Error(`File not found: ${filePath}`);
		}

		if (
			options.maxAttachmentBytes > 0 &&
			file.size > options.maxAttachmentBytes
		) {
			throw new Error(
				`File exceeds max attachment size (${options.maxAttachmentBytes} bytes): ${filePath}`,
			);
		}
	}
}

export async function sendFilesToDiscord(
	request: SendRequest,
): Promise<{ sentFiles: number; sentText: boolean; reacted: boolean }> {
	validateSendRequest(request, {
		maxAttachmentBytes: config.maxAttachmentBytes,
		fileStat: (filePath) => statSync(filePath),
	});

	const channelJid = normalizeChannelJid(request.channelJid);
	const channelId = channelJid.slice(3);
	const prepared = prepareSendText(request.text);
	const text = prepared.text;
	const attachments = await Promise.all(
		request.files.map(
			async (filePath) =>
				new AttachmentBuilder(await readFile(filePath), {
					name: basename(filePath),
				}),
		),
	);

	if (
		!text &&
		attachments.length === 0 &&
		!(prepared.reaction && request.replyToMessageId)
	) {
		return { sentFiles: 0, sentText: false, reacted: false };
	}

	const client = new Client({
		intents: [GatewayIntentBits.Guilds],
	});

	try {
		await client.login(config.discordToken);
		const channel = await client.channels.fetch(channelId);

		if (!channel || !channel.isTextBased() || !("send" in channel)) {
			throw new Error(`Channel not found or not text-based: ${channelJid}`);
		}

		let reacted = false;
		if (
			prepared.reaction &&
			request.replyToMessageId &&
			"messages" in channel
		) {
			try {
				const target = await channel.messages.fetch(request.replyToMessageId);
				await target.react(prepared.reaction);
				reacted = true;
			} catch {
				// Best-effort: never leak the directive or block the actual message when Discord refuses the reaction.
			}
		}

		if (text || attachments.length > 0) {
			await channel.send({
				content: text,
				...(request.replyToMessageId
					? {
							reply: {
								messageReference: request.replyToMessageId,
								failIfNotExists: false,
							},
						}
					: {}),
				...(attachments.length > 0 ? { files: attachments } : {}),
			});
		}
		return { sentFiles: attachments.length, sentText: Boolean(text), reacted };
	} finally {
		client.destroy();
	}
}
