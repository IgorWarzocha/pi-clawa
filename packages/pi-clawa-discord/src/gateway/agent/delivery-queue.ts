import type { DiscordDeliveryRequest } from "../delivery-types.js";
import {
	claimNextDiscordDelivery,
	cleanupDiscordInteractions,
	logMessage,
	markDiscordDeliveryDone,
	markDiscordDeliveryFailed,
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
	if (recovered > 0) logger.info({ count: recovered }, "Recovered queued Discord deliveries");
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
		active = processDelivery(delivery.rowid, delivery.request_json).finally(() => {
			active = null;
			if (running) schedule(0);
		});
	}, delayMs);
	timer.unref?.();
}

async function processDelivery(rowid: number, requestJson: string): Promise<void> {
	try {
		const request = JSON.parse(requestJson) as DiscordDeliveryRequest;
		const result = await sendDelivery(request);
		// A successful rich delivery is already the visible reply. Do not keep
		// refreshing Discord's typing indicator while the worker emits its final
		// [quiet] turn and the output monitor catches up.
		clearTypingLease(request.channelJid);
		markDiscordDeliveryDone(rowid, result);
		if (result.messageId) {
			const content = [request.title, request.text].filter(Boolean).join(" — ") || "[Discord media or interaction]";
			logMessage({
				channelJid: request.channelJid,
				role: "assistant",
				senderId: "assistant",
				senderName: "Clawa",
				sourceMessageId: result.messageId,
				content,
				timestamp: new Date().toISOString(),
			});
		}
		logger.info({ rowid, jid: request.channelJid, messageId: result.messageId }, "Queued Discord delivery sent");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		markDiscordDeliveryFailed(rowid, message);
		logger.error({ rowid, err: message }, "Queued Discord delivery failed");
	}
}
