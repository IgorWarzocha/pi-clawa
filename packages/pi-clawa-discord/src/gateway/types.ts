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
	reply_to_message_id: string | null;
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

export interface QueuedDiscordDelivery {
	rowid: number;
	request_json: string;
	status: "pending" | "processing" | "done" | "dead";
	nonce: string;
	attempt_count: number;
	max_attempts: number;
}

export interface StoredDiscordInteraction {
	token: string;
	channel_jid: string;
	message_id: string | null;
	kind: "button" | "select" | "modal";
	payload_json: string;
	expires_at: number;
	consumed_at: number | null;
}
