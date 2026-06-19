import { config } from "../config.js";
import {
	countLoggedMessagesSince,
	getAmbientLastSeenLogRowId,
	getLatestLoggedMessageRowId,
	listLoggedMessagesSince,
} from "../db.js";
import { logger } from "../logger.js";
import { AMBIENT_SENDER, buildObservedMessagesContext } from "./ambient.js";
import { buildReactionInstruction } from "./discord-directives.js";

const TIME_NOTE_INTERVAL_HOURS = 2;
const lastGatewayTimeNoteBucketByChannel = new Map<string, string>();

export interface GatewayPromptOptions {
	jid: string;
	sender: string;
	senderName: string;
	content: string;
	mappedWorker?: string;
	logRowId?: number | null;
}

export interface GatewayPrompt {
	prompt: string;
	observedThroughRowId: number;
}

export function getReplyAnchorSourceMessageId(
	sender: string,
	sourceMessageId: string | null,
): string | null {
	return sender === AMBIENT_SENDER ? null : sourceMessageId;
}

export function buildGatewayPrompt(options: GatewayPromptOptions): GatewayPrompt {
	const { jid, sender, senderName, content, mappedWorker, logRowId } = options;
	const lastSeenLogRowId = getAmbientLastSeenLogRowId(jid);
	const latestLogRowId = getLatestLoggedMessageRowId(jid);
	const observedThroughRowId = logRowId ?? latestLogRowId;
	let observedMessages =
		observedThroughRowId > lastSeenLogRowId
			? listLoggedMessagesSince(
					jid,
					lastSeenLogRowId,
					observedThroughRowId,
					config.ambientContextMessages,
				)
			: [];
	let totalNewMessages =
		observedThroughRowId > lastSeenLogRowId
			? countLoggedMessagesSince(jid, lastSeenLogRowId, observedThroughRowId)
			: 0;

	if (sender !== AMBIENT_SENDER) {
		if (logRowId) {
			const before = observedMessages.length;
			observedMessages = observedMessages.filter(
				(message) => message.rowid !== logRowId,
			);
			if (
				before !== observedMessages.length &&
				logRowId > lastSeenLogRowId &&
				logRowId <= observedThroughRowId
			) {
				totalNewMessages = Math.max(0, totalNewMessages - 1);
			}
		} else {
			const lastObserved = observedMessages.at(-1);
			if (
				lastObserved &&
				lastObserved.sender_name === senderName &&
				lastObserved.content === content
			) {
				observedMessages = observedMessages.slice(0, -1);
				totalNewMessages = Math.max(0, totalNewMessages - 1);
			}
		}
	}

	if (logRowId && logRowId < latestLogRowId) {
		logger.debug(
			{ jid, senderName, logRowId, latestLogRowId },
			"Anchored Discord prompt to queued message log row instead of latest channel log row",
		);
	}

	const observedContext = buildObservedMessagesContext(observedMessages, {
		afterRowId: lastSeenLogRowId,
		observedThroughRowId,
		totalNewMessages,
	});
	const reactionInstruction = mappedWorker ? "" : buildReactionInstruction();
	const timeNote = maybeBuildGatewayTimeNote(jid, mappedWorker);

	return {
		prompt: [
			reactionInstruction,
			timeNote,
			observedContext,
			sender === AMBIENT_SENDER
				? content
				: `[Discord user: ${senderName}]\n${content}`,
		]
			.filter(Boolean)
			.join("\n\n"),
		observedThroughRowId,
	};
}

function maybeBuildGatewayTimeNote(jid: string, mappedWorker?: string): string {
	if (!mappedWorker) {
		return "";
	}

	const now = new Date();
	const bucket = getGatewayTimeNoteBucket(now);
	if (lastGatewayTimeNoteBucketByChannel.get(jid) === bucket) {
		return "";
	}

	lastGatewayTimeNoteBucketByChannel.set(jid, bucket);
	return formatGatewayTimeNote(now);
}

function getGatewayTimeNoteBucket(date: Date): string {
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	const day = String(date.getUTCDate()).padStart(2, "0");
	const bucketHour = String(
		Math.floor(date.getUTCHours() / TIME_NOTE_INTERVAL_HOURS) *
			TIME_NOTE_INTERVAL_HOURS,
	).padStart(2, "0");
	return `${year}-${month}-${day}T${bucketHour}`;
}

function formatGatewayTimeNote(date: Date): string {
	const weekday = new Intl.DateTimeFormat("en-US", {
		weekday: "long",
		timeZone: "UTC",
	}).format(date);
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	const day = String(date.getUTCDate()).padStart(2, "0");
	const hour = String(date.getUTCHours()).padStart(2, "0");
	const minute = String(date.getUTCMinutes()).padStart(2, "0");
	return `[Time note: ${weekday} ${year}-${month}-${day} ${hour}:${minute} GMT.]`;
}
