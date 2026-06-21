import { logger } from "../logger.js";
import { getChannel, markChannelContextSeen, markMessageFailed } from "../db.js";
import { sendResponse } from "../discord/client.js";
import { settleDiscordDelivery } from "./delivery.js";
import { buildGatewayPrompt, getReplyAnchorSourceMessageId } from "./gateway-prompt.js";
import { invokeClawasWorker } from "./invoke-clawas.js";
import { resolveClawaWorkerForDiscordChannel } from "../channel-routes.js";
import { createTypingLoop } from "./typing.js";

export interface ProcessingState {
	activeClawasWorkers: Map<string, string>;
	activeReplyAnchors: Map<string, string>;
	isRunning: () => boolean;
}

function setActiveReplyAnchor(
	state: ProcessingState,
	jid: string,
	_sender: string,
	sourceMessageId: string | null,
): void {
	if (!sourceMessageId) {
		return;
	}

	state.activeReplyAnchors.set(jid, sourceMessageId);
}

export async function processQueuedMessage(params: {
	jid: string;
	rowid: number;
	sender: string;
	senderName: string;
	sourceMessageId: string | null;
	content: string;
	signal: AbortSignal;
	attachments?: string | null;
	logRowId?: number | null;
}, state: ProcessingState): Promise<void> {
	const { jid, rowid, sender, senderName, sourceMessageId, content, signal, attachments, logRowId } = params;
	const channel = getChannel(jid);
	if (!channel) {
		logger.warn({ jid }, "Channel disappeared during processing");
		markMessageFailed(rowid);
		return;
	}

	logger.info({ jid, senderName, len: content.length }, "Processing message");

	const typingLoop = createTypingLoop(jid);
	setActiveReplyAnchor(state, jid, sender, sourceMessageId);

	try {
		const mappedWorker = resolveClawaWorkerForDiscordChannel(jid);
		const { prompt, observedThroughRowId, messageHandles } = buildGatewayPrompt({
			jid,
			sender,
			senderName,
			content,
			mappedWorker,
			logRowId,
			sourceMessageId,
		});

		if (mappedWorker) {
			state.activeClawasWorkers.set(jid, mappedWorker);
		}
		if (!mappedWorker) {
			markMessageFailed(rowid);
			await sendResponse(jid, 'This Discord channel is known, but it is not routed to a Clawa yet.');
			logger.warn({ jid, rowid }, 'Discord message had no Clawa route');
			return;
		}

		const result = await invokeClawasWorker(mappedWorker, prompt, {
					signal,
					attachments,
					sourceMessageId: getReplyAnchorSourceMessageId(
						sender,
						sourceMessageId,
					),
					sourceChannelJid: jid,
					messageHandles,
				});

		if (signal.aborted) {
			markMessageFailed(rowid);
			logger.info(
				{ jid, rowid },
				"Message abandoned: shutdown interrupted processing",
			);
			return;
		}

		markChannelContextSeen(jid, observedThroughRowId);
		await settleDiscordDelivery({
			jid,
			rowid,
			sourceMessageId: state.activeReplyAnchors.get(jid) ?? sourceMessageId,
			mappedWorker,
			messageHandles,
			result,
		});
	} catch (err: any) {
		if (signal.aborted) {
			markMessageFailed(rowid);
			logger.info(
				{ jid, rowid },
				"Message abandoned: shutdown interrupted processing",
			);
			return;
		}

		logger.error({ jid, err: err.message }, "processMessage failed");
		markMessageFailed(rowid);
		try {
			await sendResponse(
				jid,
				`⚠️ Internal error: ${err.message?.slice(0, 200)}`,
			);
		} catch {
			// Nothing else to do here.
		}
	} finally {
		state.activeClawasWorkers.delete(jid);
		state.activeReplyAnchors.delete(jid);
		await typingLoop.stop();
	}
}
