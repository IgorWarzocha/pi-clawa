import type Database from "better-sqlite3";
import { logger } from "../logger.js";

export function runSchemaMigrations(db: Database.Database): void {
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

	ensureTableColumn(db, "channels", "model_override", "text not null default ''");
	ensureTableColumn(
		db,
		"channels",
		"thinking_override",
		"text not null default ''",
	);
	ensureTableColumn(db, "channels", "cwd_override", "text not null default ''");
	ensureTableColumn(db, "message_queue", "attachments", "text");
	ensureTableColumn(db, "message_queue", "source_message_id", "text");
	ensureTableColumn(db, "message_queue", "log_rowid", "integer");
	ensureTableColumn(db, "message_log", "sender_id", "text not null default ''");
	ensureTableColumn(db, "message_log", "sender_name", "text not null default ''");
}

function ensureTableColumn(
	db: Database.Database,
	table: string,
	column: string,
	ddl: string,
): void {
	const rows = db.prepare(`pragma table_info(${table})`).all() as Array<{
		name: string;
	}>;
	if (rows.some((row) => row.name === column)) return;
	db.exec(`alter table ${table} add column ${column} ${ddl}`);
	logger.info({ table, column }, "Database migrated: added column");
}
