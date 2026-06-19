import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";
import { logger } from "./logger.js";
import {
	type LoggedMessage,
	type RegisteredChannel,
	type QueuedMessage,
	type ThinkingLevel,
} from "./types.js";

let db!: Database.Database;
let dbOpen = false;

export type ScheduledTaskType = "once" | "recurring";

export interface ScheduledTaskRow {
	id: number;
	name: string;
	type: ScheduledTaskType;
	schedule: string;
	channel_jid: string;
	prompt: string;
	enabled: number;
	last_run_at: string | null;
	next_run_at: string | null;
	created_at: string;
	created_by: string;
}

interface AmbientStateRow {
	channel_jid: string;
	last_seen_log_rowid: number;
	messages_since_trigger: number;
	next_trigger_count: number;
	last_triggered_at: string | null;
}

export function initDb(): void {
	if (dbOpen) return;

	mkdirSync(dirname(config.dbPath), { recursive: true });
	db = new Database(config.dbPath);
	dbOpen = true;
	db.pragma("journal_mode = WAL");
	db.pragma("busy_timeout = 5000");

	db.exec(`
    create table if not exists channels (
      jid              text primary key,
      name             text not null,
      folder           text not null unique,
      requires_trigger integer not null default 1,
      is_main          integer not null default 0,
      model_override   text not null default '',
      thinking_override text not null default '',
      cwd_override     text not null default '',
      created_at       text not null default (datetime('now'))
    );

    create table if not exists message_queue (
      rowid         integer primary key autoincrement,
      channel_jid   text not null,
      sender        text not null,
      sender_name   text not null,
      source_message_id text,
      log_rowid     integer,
      content       text not null,
      timestamp     text not null,
      status        text not null default 'pending',
      created_at    text not null default (datetime('now')),
      processed_at  text
    );

    create index if not exists idx_queue_status on message_queue(status, channel_jid);

    create table if not exists message_log (
      rowid         integer primary key autoincrement,
      channel_jid   text not null,
      role          text not null,
      sender_id     text not null default '',
      sender_name   text not null default '',
      content       text not null,
      timestamp     text not null default (datetime('now'))
    );

    create index if not exists idx_message_log_channel_rowid on message_log(channel_jid, rowid);

    create table if not exists ambient_state (
      channel_jid            text primary key,
      last_seen_log_rowid    integer not null default 0,
      messages_since_trigger integer not null default 0,
      next_trigger_count     integer not null default 0,
      last_triggered_at      text
    );

    create table if not exists scheduled_tasks (
      id           integer primary key autoincrement,
      name         text not null,
      type         text not null check(type in ('once', 'recurring')),
      schedule     text not null,
      channel_jid  text not null,
      prompt       text not null,
      enabled      integer not null default 1,
      last_run_at  text,
      next_run_at  text,
      created_at   text not null default (datetime('now')),
      created_by   text not null default ''
    );

    create index if not exists idx_scheduled_tasks_due on scheduled_tasks(enabled, next_run_at);
  `);

	ensureTableColumn("channels", "model_override", "text not null default ''");
	ensureTableColumn(
		"channels",
		"thinking_override",
		"text not null default ''",
	);
	ensureTableColumn("channels", "cwd_override", "text not null default ''");
	ensureTableColumn("message_queue", "attachments", "text");
	ensureTableColumn("message_queue", "source_message_id", "text");
	ensureTableColumn("message_queue", "log_rowid", "integer");
	ensureTableColumn("message_log", "sender_id", "text not null default ''");
	ensureTableColumn("message_log", "sender_name", "text not null default ''");

	logger.info({ path: config.dbPath }, "Database initialized");
}

function ensureTableColumn(table: string, column: string, ddl: string): void {
	const rows = db.prepare(`pragma table_info(${table})`).all() as Array<{
		name: string;
	}>;
	if (rows.some((row) => row.name === column)) return;
	db.exec(`alter table ${table} add column ${column} ${ddl}`);
	logger.info({ table, column }, "Database migrated: added column");
}

function normalizeTimestamp(timestamp: string | null): string | null {
	if (timestamp === null) {
		return null;
	}

	const parsed = new Date(timestamp);
	if (Number.isNaN(parsed.getTime())) {
		return timestamp;
	}

	return parsed.toISOString().slice(0, 19).replace("T", " ");
}

// ── Channel registration ──

export function registerChannel(ch: RegisteredChannel): void {
	db.prepare(`
    insert into channels (jid, name, folder, requires_trigger, is_main, model_override, thinking_override, cwd_override)
    values (?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(jid) do update set
      name = excluded.name,
      folder = excluded.folder,
      requires_trigger = excluded.requires_trigger,
      is_main = excluded.is_main,
      cwd_override = case
        when excluded.cwd_override != '' then excluded.cwd_override
        else channels.cwd_override
      end
  `).run(
		ch.jid,
		ch.name,
		ch.folder,
		ch.requiresTrigger ? 1 : 0,
		ch.isMain ? 1 : 0,
		ch.modelOverride || "",
		ch.thinkingOverride || "",
		ch.cwdOverride.trim(),
	);
	logger.info({ jid: ch.jid, name: ch.name }, "Channel registered");
}

export function unregisterChannel(jid: string): boolean {
	const result = db.prepare("delete from channels where jid = ?").run(jid);
	return result.changes > 0;
}

export function getChannel(jid: string): RegisteredChannel | undefined {
	const row = db
		.prepare("select * from channels where jid = ?")
		.get(jid) as any;
	return row ? rowToChannel(row) : undefined;
}

export function getAllChannels(): RegisteredChannel[] {
	const rows = db
		.prepare("select * from channels order by created_at")
		.all() as any[];
	return rows.map(rowToChannel);
}

export function createDmChannel(
	jid: string,
	userId: string,
	displayName: string,
): RegisteredChannel {
	return {
		jid,
		name: `DM:${displayName}`,
		folder: `dm_${userId}`,
		requiresTrigger: false,
		isMain: false,
		modelOverride: "",
		thinkingOverride: "",
		cwdOverride: "",
	};
}

export function setChannelModelOverride(
	jid: string,
	modelOverride: string,
): boolean {
	const result = db
		.prepare("update channels set model_override = ? where jid = ?")
		.run(modelOverride.trim(), jid);
	return result.changes > 0;
}

export function clearChannelModelOverride(jid: string): boolean {
	const result = db
		.prepare("update channels set model_override = '' where jid = ?")
		.run(jid);
	return result.changes > 0;
}

export function setChannelThinkingOverride(
	jid: string,
	thinkingOverride: ThinkingLevel,
): boolean {
	const result = db
		.prepare("update channels set thinking_override = ? where jid = ?")
		.run(thinkingOverride, jid);
	return result.changes > 0;
}

export function clearChannelThinkingOverride(jid: string): boolean {
	const result = db
		.prepare("update channels set thinking_override = '' where jid = ?")
		.run(jid);
	return result.changes > 0;
}

function rowToChannel(row: any): RegisteredChannel {
	return {
		jid: row.jid,
		name: row.name,
		folder: row.folder,
		requiresTrigger: row.requires_trigger === 1,
		isMain: row.is_main === 1,
		modelOverride: row.model_override || "",
		thinkingOverride: (row.thinking_override || "") as ThinkingLevel | "",
		cwdOverride: row.cwd_override || "",
	};
}

// ── Message queue ──

export function enqueueMessage(msg: {
	channelJid: string;
	sender: string;
	senderName: string;
	sourceMessageId?: string | null;
	logRowId?: number | null;
	content: string;
	timestamp: string;
	attachments?: string | null;
}): void {
	db.prepare(`
    insert into message_queue (channel_jid, sender, sender_name, source_message_id, log_rowid, content, timestamp, attachments)
    values (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
		msg.channelJid,
		msg.sender,
		msg.senderName,
		msg.sourceMessageId ?? null,
		msg.logRowId ?? null,
		msg.content,
		msg.timestamp,
		msg.attachments ?? null,
	);
}

export function claimNextMessage(
	channelJid: string,
): QueuedMessage | undefined {
	const row = db
		.prepare(`
    with next_message as (
      select rowid
      from message_queue
      where status = 'pending' and channel_jid = ?
      order by rowid asc
      limit 1
    )
    update message_queue
    set status = 'processing'
    where rowid = (select rowid from next_message)
      and status = 'pending'
    returning rowid, channel_jid, sender, sender_name, source_message_id, log_rowid, content, timestamp, status, attachments
  `)
		.get(channelJid) as QueuedMessage | undefined;

	return row;
}

export function markMessageDone(rowid: number): void {
	db.prepare(
		"update message_queue set status = 'done', processed_at = datetime('now') where rowid = ?",
	).run(rowid);
}

export function markMessageFailed(rowid: number): void {
	db.prepare(
		"update message_queue set status = 'failed', processed_at = datetime('now') where rowid = ?",
	).run(rowid);
}

export function clearPendingMessages(channelJid: string): number {
	const result = db
		.prepare(
			"delete from message_queue where channel_jid = ? and status = 'pending'",
		)
		.run(channelJid);
	return result.changes;
}

export function recoverStuckMessages(): number {
	const result = db
		.prepare(
			"update message_queue set status = 'pending' where status = 'processing'",
		)
		.run();
	return result.changes;
}

/** Get channels that have pending messages */
export function channelsWithPending(): string[] {
	const rows = db
		.prepare(`
    select channel_jid
    from message_queue
    where status = 'pending'
    group by channel_jid
    order by min(rowid) asc
  `)
		.all() as any[];
	return rows.map((r) => r.channel_jid);
}

// ── Scheduled tasks ──

export function addScheduledTask(task: {
	name: string;
	type: ScheduledTaskType;
	schedule: string;
	channelJid: string;
	prompt: string;
	createdBy?: string;
	nextRunAt: string;
}): number {
	const result = db
		.prepare(`
    insert into scheduled_tasks (name, type, schedule, channel_jid, prompt, created_by, next_run_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `)
		.run(
			task.name,
			task.type,
			task.schedule,
			task.channelJid,
			task.prompt,
			task.createdBy ?? "",
			normalizeTimestamp(task.nextRunAt),
		);

	return Number(result.lastInsertRowid);
}

export function removeScheduledTask(id: number): boolean {
	const result = db.prepare("delete from scheduled_tasks where id = ?").run(id);
	return result.changes > 0;
}

export function enableScheduledTask(id: number): boolean {
	const result = db
		.prepare("update scheduled_tasks set enabled = 1 where id = ?")
		.run(id);
	return result.changes > 0;
}

export function disableScheduledTask(id: number): boolean {
	const result = db
		.prepare("update scheduled_tasks set enabled = 0 where id = ?")
		.run(id);
	return result.changes > 0;
}

export function listScheduledTasks(): ScheduledTaskRow[] {
	return db
		.prepare(`
    select id, name, type, schedule, channel_jid, prompt, enabled, last_run_at, next_run_at, created_at, created_by
    from scheduled_tasks
    order by id asc
  `)
		.all() as ScheduledTaskRow[];
}

export function getDueScheduledTasks(): ScheduledTaskRow[] {
	return db
		.prepare(`
    select id, name, type, schedule, channel_jid, prompt, enabled, last_run_at, next_run_at, created_at, created_by
    from scheduled_tasks
    where enabled = 1
      and next_run_at is not null
      and next_run_at <= datetime('now')
    order by next_run_at asc, id asc
  `)
		.all() as ScheduledTaskRow[];
}

export function updateTaskAfterRun(
	id: number,
	lastRunAt: string,
	nextRunAt: string | null,
): void {
	db.prepare(`
    update scheduled_tasks
    set last_run_at = ?,
        next_run_at = ?,
        enabled = case when ? is null then 0 else enabled end
    where id = ?
  `).run(
		normalizeTimestamp(lastRunAt),
		normalizeTimestamp(nextRunAt),
		nextRunAt,
		id,
	);
}

export function enqueueScheduledTask(
	taskId: number,
	msg: {
		channelJid: string;
		sender: string;
		senderName: string;
		sourceMessageId?: string | null;
		logRowId?: number | null;
		content: string;
		timestamp: string;
	},
	lastRunAt: string,
	nextRunAt: string | null,
): void {
	db.transaction(() => {
		enqueueMessage(msg);
		updateTaskAfterRun(taskId, lastRunAt, nextRunAt);
	})();
}

// ── Message log ──

export function logMessage(message: {
	channelJid: string;
	role: "user" | "assistant" | "reaction";
	senderId: string;
	senderName: string;
	content: string;
	timestamp: string;
}): number {
	const result = db
		.prepare(`
    insert into message_log (channel_jid, role, sender_id, sender_name, content, timestamp)
    values (?, ?, ?, ?, ?, ?)
  `)
		.run(
			message.channelJid,
			message.role,
			message.senderId,
			message.senderName,
			message.content,
			normalizeTimestamp(message.timestamp) ?? message.timestamp,
		);

	return Number(result.lastInsertRowid);
}

export function getLatestLoggedMessageRowId(channelJid: string): number {
	const row = db
		.prepare(`
    select coalesce(max(rowid), 0) as rowid
    from message_log
    where channel_jid = ?
      and role = 'user'
  `)
		.get(channelJid) as { rowid: number };
	return row?.rowid ?? 0;
}

export function countLoggedMessagesSince(
	channelJid: string,
	afterRowId: number,
	throughRowId: number,
): number {
	const row = db
		.prepare(`
    select count(*) as count
    from message_log
    where channel_jid = ?
      and role = 'user'
      and rowid > ?
      and rowid <= ?
  `)
		.get(channelJid, afterRowId, throughRowId) as { count: number };
	return row?.count ?? 0;
}

export function listLoggedMessagesSince(
	channelJid: string,
	afterRowId: number,
	throughRowId: number,
	limit: number,
): LoggedMessage[] {
	const rows =
		limit > 0
			? (db
					.prepare(`
      select rowid, channel_jid, role, sender_id, sender_name, content, timestamp
      from message_log
      where channel_jid = ?
        and role = 'user'
        and rowid > ?
        and rowid <= ?
      order by rowid desc
      limit ?
    `)
					.all(channelJid, afterRowId, throughRowId, limit) as LoggedMessage[])
			: (db
					.prepare(`
      select rowid, channel_jid, role, sender_id, sender_name, content, timestamp
      from message_log
      where channel_jid = ?
        and role = 'user'
        and rowid > ?
        and rowid <= ?
      order by rowid asc
    `)
					.all(channelJid, afterRowId, throughRowId) as LoggedMessage[]);

	return limit > 0 ? rows.reverse() : rows;
}

export function getAmbientLastSeenLogRowId(channelJid: string): number {
	const state = getOrCreateAmbientState(channelJid);
	return state.last_seen_log_rowid;
}

export function markAmbientSeen(channelJid: string, rowId: number): void {
	const state = getOrCreateAmbientState(channelJid);
	db.prepare(`
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

	db.prepare(`
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

export function closeDb(): void {
	if (!dbOpen) return;
	db.close();
	dbOpen = false;
}

function getOrCreateAmbientState(
	channelJid: string,
	minTrigger = config.ambientJitterMinMessages,
): AmbientStateRow {
	const existing = db
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

	db.prepare(`
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
