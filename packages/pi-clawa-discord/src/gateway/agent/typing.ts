import { config } from "../config.js";
import { setTyping } from "../discord/client.js";
import { logger } from "../logger.js";
import type { ClawasWorkerStatus } from "./invoke-clawas-rpc.js";

export interface TypingLoop {
	stop: () => Promise<void>;
}

const activeWorkerTypingMonitors = new Map<string, Promise<void>>();

export function createTypingLoop(jid: string): TypingLoop {
	let typingAlive = true;
	let cancelTypingDelay = () => {};

	const loop = (async () => {
		while (typingAlive) {
			await setTyping(jid);
			if (!typingAlive) break;

			const delay = cancellableSleep(config.discordTypingRefreshMs);
			cancelTypingDelay = delay.cancel;
			await delay.promise;
			cancelTypingDelay = () => {};
		}
	})();

	return {
		stop: async () => {
			typingAlive = false;
			cancelTypingDelay();
			await loop;
		},
	};
}

export function createNoopTypingLoop(): TypingLoop {
	return { stop: async () => {} };
}

export function ensureWorkerTypingMonitor(
	jid: string,
	workerId: string,
	options: {
		isRunning: () => boolean;
		getStatus: (workerId: string) => Promise<ClawasWorkerStatus>;
	},
): void {
	if (activeWorkerTypingMonitors.has(jid)) {
		return;
	}

	const monitorPromise = (async () => {
		const startedAt = Date.now();
		logger.info(
			{ jid, worker: workerId },
			"Started Discord typing keepalive for active CLAWAS worker",
		);

		while (
			options.isRunning() &&
			Date.now() - startedAt < config.clawasReplyTimeoutMs
		) {
			await setTyping(jid);

			try {
				const status = await options.getStatus(workerId);
				if (status.isIdle && !status.hasPendingMessages) {
					logger.info(
						{ jid, worker: workerId },
						"Stopped Discord typing keepalive: CLAWAS worker is idle",
					);
					return;
				}
			} catch (err: any) {
				logger.warn(
					{ jid, worker: workerId, err: err.message },
					"Discord typing keepalive could not read CLAWAS worker status",
				);
			}

			await cancellableSleep(config.discordTypingRefreshMs).promise;
		}

		logger.info(
			{ jid, worker: workerId, timeoutMs: config.clawasReplyTimeoutMs },
			"Stopped Discord typing keepalive after timeout",
		);
	})().finally(() => {
		activeWorkerTypingMonitors.delete(jid);
	});

	activeWorkerTypingMonitors.set(jid, monitorPromise);
}

function cancellableSleep(ms: number): {
	promise: Promise<void>;
	cancel: () => void;
} {
	let finished = false;
	let timer: NodeJS.Timeout | undefined;
	let resolvePromise: () => void = () => {};

	const promise = new Promise<void>((resolve) => {
		resolvePromise = () => {
			if (finished) return;
			finished = true;
			if (timer) clearTimeout(timer);
			resolve();
		};

		timer = setTimeout(resolvePromise, ms);
	});

	return {
		promise,
		cancel: resolvePromise,
	};
}
