import type { DiscordDeliveryRequest } from "../delivery-types.js";
import {
	claimNextDiscordDelivery,
	cleanupDiscordInteractions,
	logMessage,
	markDiscordDeliveryDone,
	markDiscordDeliveryAttemptFailed,
	recoverStuckDiscordDeliveries,
} from "../db.js";
import { sendDelivery } from "../discord/client.js";
import { logger } from "../logger.js";
import { clearTypingLease } from "./typing.js";

const POLL_MS = 200;
let running = false;
let timer: NodeJS.Timeout | undefined;
let active: Promise<void> | null = null;

export function startDiscordDeliveryQueue(): void {
	if (running) return;
	running = true;
	const recovered = recoverStuckDiscordDeliveries();
	if (recovered.retried > 0) {
		logger.info({ count: recovered.retried }, "Recovered queued Discord deliveries");
	}
	if (recovered.dead > 0) {
		logger.error(
			{ count: recovered.dead },
			"Discord deliveries need review after an uncertain shutdown",
		);
	}
	cleanupDiscordInteractions();
	schedule(0);
}

export async function stopDiscordDeliveryQueue(): Promise<void> {
	running = false;
	if (timer) clearTimeout(timer);
	timer = undefined;
	if (active) await active;
}

function schedule(delayMs = POLL_MS): void {
	if (!running || timer || active) return;
	timer = setTimeout(() => {
		timer = undefined;
		const delivery = claimNextDiscordDelivery();
		if (!delivery) {
			schedule();
			return;
		}
		active = processDelivery(delivery).finally(() => {
			active = null;
			if (running) schedule(0);
		});
	}, delayMs);
	timer.unref?.();
}

async function processDelivery(delivery: {
	rowid: number;
	request_json: string;
	nonce: string;
	attempt_count: number;
	max_attempts: number;
}): Promise<void> {
	let typingJid: string | undefined;
	try {
		const request = JSON.parse(delivery.request_json) as DiscordDeliveryRequest;
		typingJid = request.typingJid ?? request.channelJid;
		const result = await sendDelivery(request, delivery.nonce);
		markDiscordDeliveryDone(delivery.rowid, result);
		// A successful rich delivery is already the visible reply. Do not keep
		// refreshing Discord's typing indicator while the worker emits its final
		// [quiet] turn and the output monitor catches up.
		clearTypingLease(typingJid);
		if (result.messageId) {
			const content = [request.title, request.text].filter(Boolean).join(" — ") || "[Discord media or interaction]";
			try {
				logMessage({
					channelJid: request.channelJid,
					role: "assistant",
					senderId: "assistant",
					senderName: "Clawa",
					sourceMessageId: result.messageId,
					content,
					timestamp: new Date().toISOString(),
				});
			} catch (error) {
				logger.warn(
					{
						rowid: delivery.rowid,
						err: error instanceof Error ? error.message : String(error),
					},
					"Discord delivery succeeded but its context log could not be updated",
				);
			}
		}
		logger.info(
			{ rowid: delivery.rowid, jid: request.channelJid, messageId: result.messageId },
			"Queued Discord delivery sent",
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const status = markDiscordDeliveryAttemptFailed(delivery.rowid, message);
		if (status === "dead") clearTypingLease(typingJid);
		logger[status === "dead" ? "error" : "warn"](
			{
				rowid: delivery.rowid,
				attempt: delivery.attempt_count,
				maxAttempts: delivery.max_attempts,
				err: message,
			},
			status === "dead"
				? "Discord delivery exhausted its retries"
				: "Discord delivery failed; retry scheduled",
		);
	}
}
