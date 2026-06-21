/** A Discord channel or DM the gateway has seen */
export interface RegisteredChannel {
	jid: string;
	name: string;
	requiresTrigger: boolean;
}

/** Queued message row from SQLite */
export interface QueuedMessage {
	rowid: number;
	channel_jid: string;
	sender: string;
	sender_name: string;
	source_message_id: string | null;
	log_rowid: number | null;
	content: string;
	timestamp: string;
	status: "pending" | "processing" | "done" | "failed";
	/** JSON array of attachment metadata, or null */
	attachments: string | null;
}

export interface LoggedMessage {
	rowid: number;
	channel_jid: string;
	role: "user" | "assistant" | "reaction";
	sender_id: string;
	sender_name: string;
	source_message_id: string | null;
	content: string;
	timestamp: string;
}

export interface DiscordMessageHandle {
	label: string;
	channelJid: string;
	messageId: string;
}

/** Agent invocation result */
export interface AgentResult {
	ok: boolean;
	text: string;
	route?: "discord" | "handled" | "silent";
	error?: string;
}
