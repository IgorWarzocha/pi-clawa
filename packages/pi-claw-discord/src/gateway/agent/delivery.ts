import { addReaction, sendResponse } from "../discord/client.js";
import { isNothingForDiscord } from "../discord/send.js";
import { logMessage, markMessageDone, markMessageFailed } from "../db.js";
import { logger } from "../logger.js";
import type { AgentResult } from "../types.js";
import { AMBIENT_SENDER } from "./ambient.js";
import { extractDiscordDirectives } from "./discord-directives.js";

export interface DiscordDeliveryOptions {
	jid: string;
	rowid: number;
	sender: string;
	sourceMessageId: string | null;
	mappedWorker?: string;
	result: AgentResult;
}

export async function settleDiscordDelivery({
	jid,
	rowid,
	sender,
	sourceMessageId,
	mappedWorker,
	result,
}: DiscordDeliveryOptions): Promise<void> {
	if (!result.ok) {
		const errMsg = `⚠️ Agent error: ${result.error?.slice(0, 300) || "unknown error"}`;
		await sendResponse(jid, errMsg);
		markMessageFailed(rowid);
		logger.warn({ jid, error: result.error }, "Agent returned error");
		return;
	}

	if (result.route === "handled") {
		markMessageDone(rowid);
		logger.info(
			{ jid, worker: mappedWorker },
			"HOWABANDA worker handled routing internally",
		);
		return;
	}

	if (result.route === "silent") {
		markMessageDone(rowid);
		logger.info(
			{ jid, worker: mappedWorker, text: result.text.slice(0, 200) },
			"HOWABANDA worker produced no delivery route; skipped Discord send",
		);
		return;
	}

	const parsed = extractDiscordDirectives(result.text);

	if (parsed.reaction && sourceMessageId) {
		await addReaction(jid, sourceMessageId, parsed.reaction);
	}

	if (isNothingForDiscord(parsed.text)) {
		markMessageDone(rowid);
		logger.info(
			{ jid, sender, worker: mappedWorker, reaction: parsed.reaction },
			"Suppressed [nothing_for_discord] response text",
		);
		return;
	}

	if (!parsed.text) {
		markMessageDone(rowid);
		logger.info({ jid }, "Message handled with reaction only");
		return;
	}

	const replyToMessageId = sender === AMBIENT_SENDER ? null : sourceMessageId;
	const sent = await sendResponse(jid, parsed.text, { replyToMessageId });
	if (!sent) {
		markMessageFailed(rowid);
		logger.warn(
			{ jid },
			"Agent response generated but could not be delivered to Discord",
		);
		return;
	}

	logMessage({
		channelJid: jid,
		role: "assistant",
		senderId: "assistant",
		senderName: "Howaclawa",
		content: parsed.text,
		timestamp: new Date().toISOString(),
	});
	markMessageDone(rowid);
	logger.info(
		{ jid, responseLen: parsed.text.length, reaction: parsed.reaction },
		"Message processed",
	);
}
