import { statSync } from "node:fs";
import type {
	DiscordDeliveryRequest,
	DiscordDeliveryResult,
} from "../delivery-types.js";
import { validateDiscordDeliveryRequest } from "../delivery-types.js";
import { config } from "../config.js";
import {
	enqueueDiscordDelivery,
	getDiscordDeliveryState,
	initDb,
} from "../db.js";
import { extractDiscordDirectives } from "../agent/discord-directives.js";

export const NOTHING_FOR_DISCORD_SENTINEL = "[quiet]";
const DELIVERY_CONFIRMATION_TIMEOUT_MS = 10_000;

export interface PreparedSendText {
	text?: string | undefined;
}

export function isNothingForDiscord(text?: string): boolean {
	return text?.trim().toLowerCase() === NOTHING_FOR_DISCORD_SENTINEL;
}

export function normalizeSendText(text?: string): string | undefined {
	const trimmed = text?.trim();
	if (!trimmed || isNothingForDiscord(trimmed)) return undefined;
	return trimmed;
}

export function prepareSendText(text?: string): PreparedSendText {
	const trimmed = text?.trim();
	if (!trimmed) return { text: undefined };
	const parsed = extractDiscordDirectives(trimmed);
	return { text: normalizeSendText(parsed.text) };
}

export function normalizeChannelJid(input: string): string {
	const value = input.trim();
	return value.startsWith("dc:") ? value : `dc:${value}`;
}

export async function queueDiscordDelivery(
	request: DiscordDeliveryRequest,
): Promise<DiscordDeliveryResult> {
	const prepared = prepareSendText(request.text);
	const normalized: DiscordDeliveryRequest = {
		...request,
		channelJid: normalizeChannelJid(request.channelJid),
		text: prepared.text,
	};
	validateDiscordDeliveryRequest(normalized, {
		maxAttachmentBytes: config.maxAttachmentBytes,
		maxTotalAttachmentBytes: config.maxTotalAttachmentBytes,
		fileStat: (filePath) => statSync(filePath),
	});

	initDb();
	const rowid = enqueueDiscordDelivery(normalized);
	const startedAt = Date.now();
	while (Date.now() - startedAt < DELIVERY_CONFIRMATION_TIMEOUT_MS) {
		const state = getDiscordDeliveryState(rowid);
		if (state?.status === "done" && state.result) return state.result;
		if (state?.status === "dead") {
			throw new Error(state.error ?? "Discord delivery failed.");
		}
		await sleep(100);
	}

	// The durable queue still owns the request. Do not retry it from the worker
	// and risk duplicate public output when the gateway is merely busy.
	return {
		sentFiles: normalized.files.length,
		sentText: Boolean(normalized.text || normalized.title),
		reacted: false,
	};
}

async function sleep(ms: number): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
