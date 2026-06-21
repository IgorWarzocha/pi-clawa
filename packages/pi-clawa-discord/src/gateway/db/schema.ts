import type Database from "better-sqlite3";

export function runSchemaMigrations(db: Database.Database): void {
	db.exec(`
    create table if not exists channels (
      jid              text primary key,
      name             text not null,
      requires_trigger integer not null default 1,
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

    create table if not exists channel_context_state (
      channel_jid         text primary key,
      last_seen_log_rowid integer not null default 0
    );
  `);

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
}
