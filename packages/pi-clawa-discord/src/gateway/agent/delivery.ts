import { addReaction, sendResponse } from "../discord/client.js";
import { isNothingForDiscord } from "../discord/send.js";
import { logMessage, markMessageDone, markMessageFailed } from "../db.js";
import { logger } from "../logger.js";
import type { AgentResult } from "../types.js";
import { extractDiscordDirectives } from "./discord-directives.js";
import { parseFinalRoutes, resolveDiscordRouteTarget } from "./final-routes.js";
import { sendClawasSessionMessage } from "./invoke-clawas-rpc.js";
import type { DiscordMessageHandle } from "../types.js";

export interface DiscordDeliveryOptions {
	jid: string;
	rowid: number;
	sourceMessageId: string | null;
	mappedWorker?: string | undefined;
	messageHandles?: DiscordMessageHandle[] | undefined;
	result: AgentResult;
}

export async function settleDiscordDelivery({
	jid,
	rowid,
	sourceMessageId,
	mappedWorker,
	messageHandles = [],
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
			"CLAWAS worker handled routing internally",
		);
		return;
	}

	if (result.route === "silent") {
		markMessageDone(rowid);
		logger.info(
			{ jid, worker: mappedWorker, text: result.text.slice(0, 200) },
			"CLAWAS worker produced no delivery route; skipped Discord send",
		);
		return;
	}

	const routed = parseFinalRoutes(result.text);
	if (routed.hasRoutes) {
		try {
			for (const block of routed.blocks) {
				if (block.target.kind === "quiet") {
					await deliverDiscordText(jid, block.text, {
						defaultReplyToMessageId: null,
						mappedWorker,
						messageHandles,
					});
					continue;
				}
				if (block.target.kind === "main-clawa") {
					await sendClawasSessionMessage("main-claw", {
						message: block.text,
						messageType: "session",
						sender: {
							workerId: mappedWorker,
							workerTitle: mappedWorker,
						},
					});
					continue;
				}

				const targetJid = resolveDiscordRouteTarget(block.target, mappedWorker);
				if (!targetJid) {
					throw new Error(`Could not resolve Discord route ${formatRouteTarget(block.target)}`);
				}
				const delivered = await deliverDiscordText(targetJid, block.text, {
					defaultReplyToMessageId: targetJid === jid ? sourceMessageId : null,
					mappedWorker,
					messageHandles,
				});
				if (!delivered) {
					throw new Error(`Could not send Discord route ${formatRouteTarget(block.target)}`);
				}
			}
			markMessageDone(rowid);
			logger.info({ jid, worker: mappedWorker, routes: routed.blocks.length }, "Delivered routed Discord final message");
			return;
		} catch (err: any) {
			markMessageFailed(rowid);
			logger.warn({ jid, worker: mappedWorker, err: err.message }, "Failed to deliver routed Discord final message");
			if (mappedWorker) {
				return;
			}
			await sendResponse(jid, `⚠️ Could not route Clawa reply: ${err.message?.slice(0, 200)}`);
			return;
		}
	}

	if (mappedWorker) {
		markMessageFailed(rowid);
		logger.warn(
			{ jid, worker: mappedWorker },
			"Mapped Discord Clawa produced untagged final text; not delivering",
		);
		return;
	}

	const delivered = await deliverDiscordText(jid, result.text, {
		defaultReplyToMessageId: sourceMessageId,
	mappedWorker,
	messageHandles,
	});
	if (!delivered) {
		markMessageFailed(rowid);
		return;
	}
	markMessageDone(rowid);
}

async function deliverDiscordText(
	jid: string,
	text: string,
	options: {
		defaultReplyToMessageId: string | null;
		mappedWorker?: string | undefined;
		messageHandles: DiscordMessageHandle[];
	},
): Promise<boolean> {
	const parsed = extractDiscordDirectives(text);
	const handlesByLabel = new Map(options.messageHandles.map((handle) => [handle.label.toLowerCase(), handle]));

	for (const reaction of parsed.reactions) {
		const handle = handlesByLabel.get(reaction.handle.toLowerCase());
		if (!handle) {
			throw new Error(`Unknown reaction handle: ${reaction.handle}`);
		}
		await addReaction(handle.channelJid, handle.messageId, reaction.emoji);
	}

	if (isNothingForDiscord(parsed.text)) {
		logger.info(
		{ jid, worker: options.mappedWorker, reactions: parsed.reactions.length },
			"Suppressed [quiet] response text",
		);
		return true;
	}

	if (!parsed.text) {
		logger.info({ jid }, "Message handled with reaction only");
		return true;
	}

	const sent = await sendResponse(jid, parsed.text, { replyToMessageId: options.defaultReplyToMessageId });
	if (!sent) {
		logger.warn(
			{ jid },
			"Agent response generated but could not be delivered to Discord",
		);
		return false;
	}

	logMessage({
		channelJid: jid,
		role: "assistant",
		senderId: "assistant",
		senderName: "Clawa",
		content: parsed.text,
		timestamp: new Date().toISOString(),
	});
	logger.info(
		{ jid, responseLen: parsed.text.length, reactions: parsed.reactions.length },
		"Message processed",
	);
	return true;
}

function formatRouteTarget(target: { kind: string; label?: string }): string {
	return target.kind === "channel" ? target.label ?? "#channel" : target.kind;
}
