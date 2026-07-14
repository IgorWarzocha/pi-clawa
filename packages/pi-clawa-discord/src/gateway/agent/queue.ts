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
	recoverStuckMessages,
} from "../db.js";
import { processQueuedMessage } from "./queue-processing.js";
import { startWorkerOutputMonitors, stopWorkerOutputMonitors } from "./worker-output-monitor.js";

/** Channels currently being processed (per-channel serial lock) */
const activeChannels = new Set<string>();
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
	startWorkerOutputMonitors();
}

export function stopProcessingLoop(
	opts: { timeoutMs?: number } = {},
): Promise<void> {
	if (stopPromise) {
		return stopPromise;
	}

	running = false;
	clearPollTimer();
	stopWorkerOutputMonitors();

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
			continue;
		}
		if (activeTaskPromises.size >= config.maxConcurrency) break;

		const msg = claimNextMessage(jid);
		if (!msg) continue;

		const controller = new AbortController();
		activeChannels.add(jid);
		activeTaskControllers.set(msg.rowid, controller);
		activeChannelControllers.set(jid, controller);

		const taskPromise = processQueuedMessage(
			{
				jid,
				rowid: msg.rowid,
				sender: msg.sender,
				senderName: msg.sender_name,
				sourceMessageId: msg.source_message_id,
				replyToMessageId: msg.reply_to_message_id,
				content: msg.content,
				signal: controller.signal,
				attachments: msg.attachments,
				logRowId: msg.log_rowid,
			}
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
