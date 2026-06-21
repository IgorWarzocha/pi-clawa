import { config } from "../config.js";
import {
	countLoggedMessagesSince,
	getChannelContextLastSeenLogRowId,
	getLatestLoggedMessageRowId,
	listLoggedMessagesSince,
} from "../db.js";
import { logger } from "../logger.js";
import { buildReactionInstruction } from "./discord-directives.js";
import type { LoggedMessage } from "../types.js";

const TIME_NOTE_INTERVAL_HOURS = 2;
const RECENT_CONTEXT_CHAR_BUDGET = 4000;
const RECENT_CONTEXT_MESSAGE_CHAR_BUDGET = 600;
const lastGatewayTimeNoteBucketByChannel = new Map<string, string>();

export interface GatewayPromptOptions {
	jid: string;
	sender: string;
	senderName: string;
	content: string;
	mappedWorker?: string | undefined;
	logRowId?: number | null | undefined;
}

export interface GatewayPrompt {
	prompt: string;
	observedThroughRowId: number;
}

export function getReplyAnchorSourceMessageId(
	_sender: string,
	sourceMessageId: string | null,
): string | null {
	return sourceMessageId;
}

export function buildGatewayPrompt(options: GatewayPromptOptions): GatewayPrompt {
	const { jid, senderName, content, mappedWorker, logRowId } = options;
	const lastSeenLogRowId = getChannelContextLastSeenLogRowId(jid);
	const latestLogRowId = getLatestLoggedMessageRowId(jid);
	const observedThroughRowId = logRowId ?? latestLogRowId;
	let observedMessages =
		observedThroughRowId > lastSeenLogRowId
			? listLoggedMessagesSince(
					jid,
					lastSeenLogRowId,
					observedThroughRowId,
					config.recentContextMessages,
				)
			: [];
	let totalNewMessages =
		observedThroughRowId > lastSeenLogRowId
			? countLoggedMessagesSince(jid, lastSeenLogRowId, observedThroughRowId)
			: 0;

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
			`[Discord user: ${senderName}]\n${content}`,
		]
			.filter(Boolean)
			.join("\n\n"),
		observedThroughRowId,
	};
}

function buildObservedMessagesContext(
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

	const { lines, omittedForSize } = buildBoundedObservedMessageLines(messages);
	if (lines.length === 0) {
		return "";
	}

	const truncated =
		opts.totalNewMessages > messages.length
			? ` Only the most recent ${messages.length} of ${opts.totalNewMessages} new messages are shown.`
			: "";
	const sizeNote =
		omittedForSize > 0
			? ` ${omittedForSize} older/newer context message${omittedForSize === 1 ? "" : "s"} omitted to keep the Discord turn small.`
			: "";

	return [
		`Recent channel context:${truncated}${sizeNote}`,
		...lines,
		"End recent channel context.",
	].join("\n");
}

function buildBoundedObservedMessageLines(messages: LoggedMessage[]): {
	lines: string[];
	omittedForSize: number;
} {
	const kept: string[] = [];
	let remaining = RECENT_CONTEXT_CHAR_BUDGET;
	let omittedForSize = 0;

	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!message) {
			continue;
		}

		const line = `${message.sender_name}: ${truncateText(message.content, RECENT_CONTEXT_MESSAGE_CHAR_BUDGET)}`;
		const cost = line.length + 1;
		if (cost > remaining && kept.length > 0) {
			omittedForSize += 1;
			continue;
		}

		kept.unshift(line.length > remaining ? line.slice(0, Math.max(0, remaining - 1)) + "…" : line);
		remaining -= Math.min(cost, remaining);
	}

	return { lines: kept, omittedForSize };
}

function truncateText(value: string, maxChars: number): string {
	if (value.length <= maxChars) {
		return value;
	}

	return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
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
