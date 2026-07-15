import { config } from "../config.js";
import {
	countLoggedMessagesSince,
	getChannel,
	getChannelContextLastSeenLogRowId,
	getLatestLoggedMessageRowId,
	listLoggedMessagesSince,
} from "../db.js";
import { logger } from "../logger.js";
import { buildReactionInstruction } from "./discord-directives.js";
import type { DiscordMessageHandle, LoggedMessage } from "../types.js";

const TIME_NOTE_INTERVAL_HOURS = 2;
const lastGatewayTimeNoteBucketByChannel = new Map<string, string>();

export interface GatewayPromptOptions {
	jid: string;
	sender: string;
	senderName: string;
	content: string;
	mappedWorker?: string | undefined;
	logRowId?: number | null | undefined;
	sourceMessageId?: string | null | undefined;
	replyContext?: string | null | undefined;
}

export interface GatewayPrompt {
	prompt: string;
	observedThroughRowId: number;
	messageHandles: DiscordMessageHandle[];
}

export function getReplyAnchorSourceMessageId(
	_sender: string,
	sourceMessageId: string | null,
): string | null {
	return sourceMessageId;
}

export function buildGatewayPrompt(options: GatewayPromptOptions): GatewayPrompt {
	const { jid, senderName, content, mappedWorker, logRowId, sourceMessageId, replyContext } = options;
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

	const messageHandles: DiscordMessageHandle[] = [];
	let nextHandleNumber = 1;
	const observedContext = buildObservedMessagesContext(observedMessages, {
		afterRowId: lastSeenLogRowId,
		observedThroughRowId,
		totalNewMessages,
		createHandle: (message) => {
			if (!message.source_message_id) return undefined;
			const label = `m${nextHandleNumber++}`;
			messageHandles.push({
				label,
				channelJid: message.channel_jid,
				messageId: message.source_message_id,
			});
			return label;
		},
	});
	const currentHandle = sourceMessageId?.trim() ? `m${nextHandleNumber++}` : undefined;
	if (currentHandle && sourceMessageId) {
		messageHandles.push({ label: currentHandle, channelJid: jid, messageId: sourceMessageId });
	}
	const reactionInstruction = mappedWorker ? "" : buildReactionInstruction();
	const timeNote = maybeBuildGatewayTimeNote(jid, mappedWorker);

	return {
		prompt: [
			reactionInstruction,
			timeNote,
			buildDiscordSourceLine(jid),
			observedContext,
			replyContext?.trim() ?? "",
			`Current trigger:\n${formatMessageLine({ handle: currentHandle, senderName, content })}`,
		]
			.filter(Boolean)
			.join("\n\n"),
		observedThroughRowId,
		messageHandles,
	};
}

function buildDiscordSourceLine(jid: string): string {
	const channel = getChannel(jid);
	const name = channel?.name.trim() ?? '';
	if (name.toLowerCase().startsWith('dm:')) {
		return 'Source: [dm].';
	}

	const hashIndex = name.lastIndexOf('#');
	if (hashIndex !== -1) {
		return `Source: [${name.slice(hashIndex).trim().toLowerCase()}].`;
	}

	return 'Source: [channel].';
}

function buildObservedMessagesContext(
	messages: LoggedMessage[],
	opts: {
		afterRowId: number;
		observedThroughRowId: number;
		totalNewMessages: number;
		createHandle: (message: LoggedMessage) => string | undefined;
	},
): string {
	if (messages.length === 0) {
		return "";
	}

	const lines = messages.map((message) =>
		formatMessageLine({
			handle: opts.createHandle(message),
			senderName: message.sender_name,
			content: message.content,
		}),
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

function formatMessageLine(options: {
	handle?: string | undefined;
	senderName: string;
	content: string;
}): string {
	const prefix = options.handle ? `[${options.handle}] ` : "";
	const lines = options.content.split(/\r?\n/u);
	const first = lines.shift() ?? "";
	const head = `${prefix}${options.senderName}:${first ? ` ${first}` : ""}`;
	return [head, ...lines.map((line) => `    ${line}`)].join("\n");
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
