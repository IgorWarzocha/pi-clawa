import {
	PermissionFlagsBits,
	type Client,
	type DMChannel,
	type TextChannel,
} from "discord.js";
import { logger } from "../logger.js";
import { replacePlainUserMentions, type MentionCandidate } from "./mentions.js";

const DISCORD_MAX_LENGTH = 2000;

export async function sendResponseWithClient(
	client: Client | null,
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

export async function setTypingWithClient(
	client: Client | null,
	jid: string,
): Promise<void> {
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

export async function addReactionWithClient(
	client: Client | null,
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

function splitMessage(text: string, max: number): string[] {
	const chunks: string[] = [];
	let remaining = text;

	while (remaining.length > max) {
		let splitAt = remaining.lastIndexOf("\n", max);
		if (splitAt <= 0) splitAt = max;
		chunks.push(remaining.slice(0, splitAt));
		remaining = remaining.slice(splitAt).replace(/^\n/, "");
	}
	if (remaining) chunks.push(remaining);
	return chunks;
}
