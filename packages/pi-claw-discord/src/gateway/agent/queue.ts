/**
 * Message processing loop.
 *
 * Polls SQLite for pending messages, dispatches to pi agent, sends response
 * back to Discord. Enforces per-channel serial processing and global
 * concurrency limit.
 */

import { config } from "../config.js";
import { logger } from "../logger.js";
import {
	channelsWithPending,
	claimNextMessage,
	clearPendingMessages,
	getChannel,
	markAmbientSeen,
	markMessageDone,
	markMessageFailed,
	recoverStuckMessages,
} from "../db.js";
import { invokeAgent } from "./invoke.js";
import {
	getClawasWorkerStatus,
	invokeClawasWorker,
	steerClawasWorker,
} from "./invoke-clawas.js";
import { sendResponse } from "../discord/client.js";
import { computeEffectiveChannelSettings } from "./channel-settings.js";
import { AMBIENT_SENDER } from "./ambient.js";
import {
	buildGatewayPrompt,
	getReplyAnchorSourceMessageId,
} from "./gateway-prompt.js";
import { settleDiscordDelivery } from "./delivery.js";
import {
	createNoopTypingLoop,
	createTypingLoop,
	ensureWorkerTypingMonitor,
} from "./typing.js";

/** Channels currently being processed (per-channel serial lock) */
const activeChannels = new Set<string>();
const activeClawasWorkers = new Map<string, string>();
const activeReplyAnchors = new Map<string, string>();
const activeTaskPromises = new Set<Promise<void>>();
const activeTaskControllers = new Map<number, AbortController>();
const activeChannelControllers = new Map<string, AbortController>();

let running = false;
let pollTimer: NodeJS.Timeout | undefined;
let stopPromise: Promise<void> | null = null;

export function isChannelProcessing(jid: string): boolean {
	return activeChannels.has(jid);
}

export function abortChannelTask(jid: string): {
	aborted: boolean;
	cleared: number;
} {
	const controller = activeChannelControllers.get(jid);
	const aborted = Boolean(controller);
	if (controller) {
		controller.abort();
	}
	const cleared = clearPendingMessages(jid);
	return { aborted, cleared };
}

export function startProcessingLoop(): void {
	if (running) return;

	running = true;
	stopPromise = null;

	// Recover any messages stuck in 'processing' from a previous crash.
	const recovered = recoverStuckMessages();
	if (recovered > 0) {
		logger.info({ count: recovered }, "Recovered stuck messages");
	}

	schedulePoll(0);
}

export function stopProcessingLoop(
	opts: { timeoutMs?: number } = {},
): Promise<void> {
	if (stopPromise) {
		return stopPromise;
	}

	running = false;
	clearPollTimer();

	stopPromise = drainActiveTasks(opts.timeoutMs ?? config.shutdownTimeoutMs);
	return stopPromise;
}

function schedulePoll(delayMs = config.pollInterval): void {
	if (!running || pollTimer) return;

	pollTimer = setTimeout(() => {
		pollTimer = undefined;
		poll();
	}, delayMs);
}

function clearPollTimer(): void {
	if (!pollTimer) return;
	clearTimeout(pollTimer);
	pollTimer = undefined;
}

function poll(): void {
	if (!running) return;

	try {
		dispatch();
	} catch (err: any) {
		logger.error({ err: err.message }, "Poll error");
	} finally {
		schedulePoll();
	}
}

function dispatch(): void {
	if (activeTaskPromises.size >= config.maxConcurrency) return;

	for (const jid of channelsWithPending()) {
		if (activeChannels.has(jid)) {
			const mappedWorker = activeClawasWorkers.get(jid);
			if (!mappedWorker || activeTaskPromises.size >= config.maxConcurrency)
				continue;

			const msg = claimNextMessage(jid);
			if (!msg) continue;

			const taskPromise = processSteeredClawasMessage(
				mappedWorker,
				jid,
				msg.rowid,
				msg.sender,
				msg.sender_name,
				msg.source_message_id,
				msg.content,
				msg.attachments,
				msg.log_rowid,
			).finally(() => {
				activeTaskPromises.delete(taskPromise);

				if (running) {
					schedulePoll(0);
				}
			});

			activeTaskPromises.add(taskPromise);
			continue;
		}
		if (activeTaskPromises.size >= config.maxConcurrency) break;

		const msg = claimNextMessage(jid);
		if (!msg) continue;

		const controller = new AbortController();
		activeChannels.add(jid);
		activeTaskControllers.set(msg.rowid, controller);
		activeChannelControllers.set(jid, controller);

		const taskPromise = processMessage(
			jid,
			msg.rowid,
			msg.sender,
			msg.sender_name,
			msg.source_message_id,
			msg.content,
			controller.signal,
			msg.attachments,
			msg.log_rowid,
		).finally(() => {
			activeChannels.delete(jid);
			activeTaskControllers.delete(msg.rowid);
			activeChannelControllers.delete(jid);
			activeTaskPromises.delete(taskPromise);

			if (running) {
				schedulePoll(0);
			}
		});

		activeTaskPromises.add(taskPromise);
	}
}

async function drainActiveTasks(timeoutMs: number): Promise<void> {
	if (activeTaskPromises.size === 0) {
		return;
	}

	const initialDrain = Promise.allSettled([...activeTaskPromises]);
	const drainedGracefully = await waitForPromise(initialDrain, timeoutMs);
	if (drainedGracefully) {
		return;
	}

	logger.warn(
		{ timeoutMs, activeTasks: activeTaskPromises.size },
		"Shutdown timeout reached; aborting in-flight message processing",
	);

	for (const controller of activeTaskControllers.values()) {
		controller.abort();
	}

	if (activeTaskPromises.size > 0) {
		await Promise.race([
			Promise.allSettled([...activeTaskPromises]),
			new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
		]);
	}
}

async function waitForPromise(
	promise: Promise<unknown>,
	timeoutMs: number,
): Promise<boolean> {
	if (timeoutMs === 0) {
		return false;
	}

	let timer: NodeJS.Timeout | undefined;

	try {
		await Promise.race([
			promise,
			new Promise((resolve) => {
				timer = setTimeout(resolve, timeoutMs);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}

	return activeTaskPromises.size === 0;
}


function setActiveReplyAnchor(
	jid: string,
	sender: string,
	sourceMessageId: string | null,
): void {
	if (sender === AMBIENT_SENDER || !sourceMessageId) {
		return;
	}

	activeReplyAnchors.set(jid, sourceMessageId);
}

async function processMessage(
	jid: string,
	rowid: number,
	sender: string,
	senderName: string,
	sourceMessageId: string | null,
	content: string,
	signal: AbortSignal,
	attachments?: string | null,
	logRowId?: number | null,
): Promise<void> {
	const channel = getChannel(jid);
	if (!channel) {
		logger.warn({ jid }, "Channel disappeared during processing");
		markMessageFailed(rowid);
		return;
	}

	logger.info({ jid, senderName, len: content.length }, "Processing message");

	const typingLoop =
		sender === AMBIENT_SENDER ? createNoopTypingLoop() : createTypingLoop(jid);
	setActiveReplyAnchor(jid, sender, sourceMessageId);

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
			activeClawasWorkers.set(jid, mappedWorker);
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
			sourceMessageId: activeReplyAnchors.get(jid) ?? sourceMessageId,
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
		activeClawasWorkers.delete(jid);
		activeReplyAnchors.delete(jid);
		await typingLoop.stop();
	}
}

async function processSteeredClawasMessage(
	workerId: string,
	jid: string,
	rowid: number,
	sender: string,
	senderName: string,
	sourceMessageId: string | null,
	content: string,
	attachments?: string | null,
	logRowId?: number | null,
): Promise<void> {
	try {
		setActiveReplyAnchor(jid, sender, sourceMessageId);

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
				isRunning: () => running,
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

