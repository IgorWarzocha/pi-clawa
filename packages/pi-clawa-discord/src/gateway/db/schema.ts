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
      source_message_id text,
      content       text not null,
      timestamp     text not null default (datetime('now'))
    );

    create index if not exists idx_message_log_channel_rowid on message_log(channel_jid, rowid);

    create table if not exists channel_context_state (
      channel_jid         text primary key,
      last_seen_log_rowid integer not null default 0
    );

    create table if not exists clawa_worker_outputs (
      worker_id         text not null,
      message_timestamp integer not null,
      content_hash      text not null,
      processed_at      text not null default (datetime('now')),
      primary key (worker_id, message_timestamp, content_hash)
    );

    create table if not exists discord_delivery_queue (
      rowid             integer primary key autoincrement,
      delivery_key      text,
      nonce             text,
      request_json      text not null,
      status            text not null default 'pending',
      attempt_count     integer not null default 0,
      max_attempts      integer not null default 5,
      next_attempt_at   integer not null default 0,
      result_json       text,
      error             text,
      created_at        text not null default (datetime('now')),
      started_at        text,
      processed_at      text
    );

    create index if not exists idx_discord_delivery_queue_status
      on discord_delivery_queue(status, rowid);

    create table if not exists discord_interactions (
      token         text primary key,
      channel_jid   text not null,
      message_id    text,
      kind          text not null,
      payload_json  text not null,
      expires_at    integer not null,
      consumed_at   integer
    );

    create index if not exists idx_discord_interactions_expiry
      on discord_interactions(expires_at);
  `);

	ensureTableColumn(db, "message_queue", "attachments", "text");
	ensureTableColumn(db, "message_queue", "source_message_id", "text");
	ensureTableColumn(db, "message_queue", "reply_to_message_id", "text");
	ensureTableColumn(db, "message_queue", "log_rowid", "integer");
	ensureTableColumn(db, "message_log", "sender_id", "text not null default ''");
	ensureTableColumn(db, "message_log", "sender_name", "text not null default ''");
	ensureTableColumn(db, "message_log", "source_message_id", "text");
	ensureTableColumn(db, "discord_delivery_queue", "delivery_key", "text");
	ensureTableColumn(db, "discord_delivery_queue", "nonce", "text");
	ensureTableColumn(db, "discord_delivery_queue", "attempt_count", "integer not null default 0");
	ensureTableColumn(db, "discord_delivery_queue", "max_attempts", "integer not null default 5");
	ensureTableColumn(db, "discord_delivery_queue", "next_attempt_at", "integer not null default 0");
	ensureTableColumn(db, "discord_delivery_queue", "started_at", "text");
	db.exec(`
    update discord_delivery_queue
    set delivery_key = 'legacy:' || rowid
    where delivery_key is null;
    update discord_delivery_queue
    set nonce = printf('clawa-%019d', rowid)
    where nonce is null;
    update discord_delivery_queue
    set status = 'dead'
    where status = 'failed';
    create unique index if not exists idx_discord_delivery_queue_key
      on discord_delivery_queue(delivery_key);
  `);

	// Discord may replay events after reconnects. Migrate old duplicate rows as one
	// transaction, preserving completed work first and keeping queue log anchors valid.
	db.transaction(() => {
		db.exec(`
      update message_queue
      set log_rowid = (
        select min(message_log.rowid)
        from message_log
        where message_log.channel_jid = message_queue.channel_jid
          and message_log.role = 'user'
          and message_log.source_message_id = message_queue.source_message_id
      )
      where source_message_id is not null
        and exists (
          select 1
          from message_log
          where message_log.channel_jid = message_queue.channel_jid
            and message_log.role = 'user'
            and message_log.source_message_id = message_queue.source_message_id
        );

      delete from message_log
      where rowid in (
        select rowid
        from (
          select
            rowid,
            row_number() over (
              partition by channel_jid, role, source_message_id
              order by rowid asc
            ) as duplicate_rank
          from message_log
          where source_message_id is not null
        )
        where duplicate_rank > 1
      );

      delete from message_queue
      where rowid in (
        select rowid
        from (
          select
            rowid,
            row_number() over (
              partition by channel_jid, source_message_id
              order by
                case status
                  when 'done' then 0
                  when 'processing' then 1
                  when 'pending' then 2
                  else 3
                end,
                rowid desc
            ) as duplicate_rank
          from message_queue
          where source_message_id is not null
        )
        where duplicate_rank > 1
      );

      create unique index if not exists idx_queue_discord_source
        on message_queue(channel_jid, source_message_id)
        where source_message_id is not null;
      create unique index if not exists idx_log_discord_source
        on message_log(channel_jid, role, source_message_id)
        where source_message_id is not null;
    `);
	})();
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
