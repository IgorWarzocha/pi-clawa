import type { LoggedMessage } from "../types.js";
import { NOTHING_FOR_DISCORD_SENTINEL } from "../discord/send.js";

export const AMBIENT_SENDER = "ambient:jitter";
export const AMBIENT_NOTHING_FOR_DISCORD_SENTINEL =
	NOTHING_FOR_DISCORD_SENTINEL;

export function randomBetween(
	min: number,
	max: number,
	rand = Math.random,
): number {
	if (max <= min) return min;
	return min + Math.floor(rand() * (max - min + 1));
}

export function buildObservedMessagesContext(
	messages: LoggedMessage[],
	opts: {
		afterRowId: number;
		observedThroughRowId: number;
		totalNewMessages: number;
	},
): string {
	if (messages.length === 0) {
		return "";
	}

	const lines = messages.map(
		(message) => `${message.sender_name}: ${message.content}`,
	);
	const truncated =
		opts.totalNewMessages > messages.length
			? ` Only the most recent ${messages.length} of ${opts.totalNewMessages} new messages are shown.`
			: "";

	return [
		`Recent channel context:${truncated}`,
		...lines,
		"End recent channel context.",
	].join("\n");
}

export function buildAmbientPrompt(): string {
	return [
		"Ambient check: chime in only if a brief public note would add real value; otherwise reply with exactly [nothing_for_discord].",
	].join("\n");
}

export function containsNothingForDiscordSentinel(text: string): boolean {
	return text.toLowerCase().includes(AMBIENT_NOTHING_FOR_DISCORD_SENTINEL);
}
