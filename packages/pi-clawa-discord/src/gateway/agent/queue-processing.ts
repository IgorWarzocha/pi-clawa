import { config } from "../config.js";
import { logger } from "../logger.js";
import { getChannel, markAmbientSeen, markMessageDone, markMessageFailed } from "../db.js";
import { sendResponse } from "../discord/client.js";
import { AMBIENT_SENDER } from "./ambient.js";
import { computeEffectiveChannelSettings } from "./channel-settings.js";
import { settleDiscordDelivery } from "./delivery.js";
import { buildGatewayPrompt, getReplyAnchorSourceMessageId } from "./gateway-prompt.js";
import { invokeAgent } from "./invoke.js";
import { getClawasWorkerStatus, invokeClawasWorker, steerClawasWorker } from "./invoke-clawas.js";
import { createNoopTypingLoop, createTypingLoop, ensureWorkerTypingMonitor } from "./typing.js";

export interface ProcessingState {
	activeClawasWorkers: Map<string, string>;
	activeReplyAnchors: Map<string, string>;
	isRunning: () => boolean;
}

function setActiveReplyAnchor(
	state: ProcessingState,
	jid: string,
	sender: string,
	sourceMessageId: string | null,
): void {
	if (sender === AMBIENT_SENDER || !sourceMessageId) {
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

	const typingLoop =
		sender === AMBIENT_SENDER ? createNoopTypingLoop() : createTypingLoop(jid);
	setActiveReplyAnchor(state, jid, sender, sourceMessageId);

	try {
		const mappedWorker = config.clawasChannelWorkers.get(jid);
		const { prompt, observedThroughRowId } = buildGatewayPrompt({
			jid,
			sender,
			senderName,
			content,
			mappedWorker,
			logRowId,
		});

		const effective = computeEffectiveChannelSettings(channel);
		if (mappedWorker) {
			state.activeClawasWorkers.set(jid, mappedWorker);
		}

		const result = mappedWorker
			? await invokeClawasWorker(mappedWorker, prompt, {
					signal,
					attachments,
					sourceMessageId: getReplyAnchorSourceMessageId(
						sender,
						sourceMessageId,
					),
				})
			: await invokeAgent(channel.folder, prompt, {
					model: effective.rawModelRef || undefined,
					thinking: effective.hasManagedThinking
						? effective.effectiveThinking
						: undefined,
					cwd: effective.effectiveCwd,
					signal,
					attachments,
				});

		if (signal.aborted) {
			markMessageFailed(rowid);
			logger.info(
				{ jid, rowid },
				"Message abandoned: shutdown interrupted processing",
			);
			return;
		}

		markAmbientSeen(jid, observedThroughRowId);
		await settleDiscordDelivery({
			jid,
			rowid,
			sender,
			sourceMessageId: state.activeReplyAnchors.get(jid) ?? sourceMessageId,
			mappedWorker,
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

export async function processSteeredClawasMessage(params: {
	workerId: string;
	jid: string;
	rowid: number;
	sender: string;
	senderName: string;
	sourceMessageId: string | null;
	content: string;
	attachments?: string | null;
	logRowId?: number | null;
}, state: ProcessingState): Promise<void> {
	const { workerId, jid, rowid, sender, senderName, sourceMessageId, content, attachments, logRowId } = params;
	try {
		setActiveReplyAnchor(state, jid, sender, sourceMessageId);

		const { prompt, observedThroughRowId } = buildGatewayPrompt({
			jid,
			sender,
			senderName,
			content,
			mappedWorker: workerId,
			logRowId,
		});

		await steerClawasWorker(workerId, prompt, {
			attachments,
			sourceMessageId: getReplyAnchorSourceMessageId(sender, sourceMessageId),
		});

		if (sender !== AMBIENT_SENDER) {
			ensureWorkerTypingMonitor(jid, workerId, {
				isRunning: state.isRunning,
				getStatus: getClawasWorkerStatus,
			});
		}

		markAmbientSeen(jid, observedThroughRowId);
		markMessageDone(rowid);
		logger.info(
			{ jid, worker: workerId, rowid },
			"Steered queued Discord message into active CLAWAS worker",
		);
	} catch (err: any) {
		markMessageFailed(rowid);
		logger.warn(
			{ jid, worker: workerId, rowid, err: err.message },
			"Failed to steer queued Discord message into CLAWAS worker",
		);
	}
}
