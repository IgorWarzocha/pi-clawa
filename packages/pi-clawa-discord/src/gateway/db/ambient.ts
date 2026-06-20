import { config } from "../config.js";
import { getDb, normalizeTimestamp } from "./connection.js";

interface AmbientStateRow {
	channel_jid: string;
	last_seen_log_rowid: number;
	messages_since_trigger: number;
	next_trigger_count: number;
	last_triggered_at: string | null;
}

export function getAmbientLastSeenLogRowId(channelJid: string): number {
	const state = getOrCreateAmbientState(channelJid);
	return state.last_seen_log_rowid;
}

export function markAmbientSeen(channelJid: string, rowId: number): void {
	const state = getOrCreateAmbientState(channelJid);
	getDb().prepare(`
    insert into ambient_state (channel_jid, last_seen_log_rowid, messages_since_trigger, next_trigger_count, last_triggered_at)
    values (?, ?, ?, ?, ?)
    on conflict(channel_jid) do update set
      last_seen_log_rowid = max(ambient_state.last_seen_log_rowid, excluded.last_seen_log_rowid),
      messages_since_trigger = ambient_state.messages_since_trigger,
      next_trigger_count = ambient_state.next_trigger_count,
      last_triggered_at = ambient_state.last_triggered_at
  `).run(
		channelJid,
		rowId,
		state.messages_since_trigger,
		state.next_trigger_count,
		state.last_triggered_at,
	);
}

export function noteAmbientObservedMessage(
	channelJid: string,
	opts: {
		now: string;
		minMessages: number;
		maxMessages: number;
		cooldownSeconds: number;
		random: () => number;
	},
): boolean {
	const state = getOrCreateAmbientState(channelJid, opts.minMessages);
	const nextTrigger =
		state.next_trigger_count > 0
			? state.next_trigger_count
			: randomTriggerCount(opts.minMessages, opts.maxMessages, opts.random);
	const nextCount = state.messages_since_trigger + 1;
	const cooldownReady =
		!state.last_triggered_at ||
		Date.now() - new Date(state.last_triggered_at).getTime() >=
			opts.cooldownSeconds * 1000;
	const shouldTrigger = cooldownReady && nextCount >= nextTrigger;

	getDb().prepare(`
    insert into ambient_state (channel_jid, last_seen_log_rowid, messages_since_trigger, next_trigger_count, last_triggered_at)
    values (?, ?, ?, ?, ?)
    on conflict(channel_jid) do update set
      messages_since_trigger = excluded.messages_since_trigger,
      next_trigger_count = excluded.next_trigger_count,
      last_triggered_at = excluded.last_triggered_at,
      last_seen_log_rowid = ambient_state.last_seen_log_rowid
  `).run(
		channelJid,
		state.last_seen_log_rowid,
		shouldTrigger ? 0 : nextCount,
		shouldTrigger
			? randomTriggerCount(opts.minMessages, opts.maxMessages, opts.random)
			: nextTrigger,
		shouldTrigger ? normalizeTimestamp(opts.now) : state.last_triggered_at,
	);

	return shouldTrigger;
}

function getOrCreateAmbientState(
	channelJid: string,
	minTrigger = config.ambientJitterMinMessages,
): AmbientStateRow {
	const existing = getDb()
		.prepare(`
    select channel_jid, last_seen_log_rowid, messages_since_trigger, next_trigger_count, last_triggered_at
    from ambient_state
    where channel_jid = ?
  `)
		.get(channelJid) as AmbientStateRow | undefined;

	if (existing) {
		return existing;
	}

	const created: AmbientStateRow = {
		channel_jid: channelJid,
		last_seen_log_rowid: 0,
		messages_since_trigger: 0,
		next_trigger_count: minTrigger,
		last_triggered_at: null,
	};

	getDb().prepare(`
    insert into ambient_state (channel_jid, last_seen_log_rowid, messages_since_trigger, next_trigger_count, last_triggered_at)
    values (?, ?, ?, ?, ?)
  `).run(
		created.channel_jid,
		created.last_seen_log_rowid,
		created.messages_since_trigger,
		created.next_trigger_count,
		created.last_triggered_at,
	);

	return created;
}

function randomTriggerCount(
	min: number,
	max: number,
	random: () => number,
): number {
	if (max <= min) return min;
	return min + Math.floor(random() * (max - min + 1));
}
