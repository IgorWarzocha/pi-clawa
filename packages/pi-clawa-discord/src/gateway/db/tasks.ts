import { getDb, normalizeTimestamp } from "./connection.js";
import { enqueueMessage } from "./queue.js";

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

export function addScheduledTask(task: {
	name: string;
	type: ScheduledTaskType;
	schedule: string;
	channelJid: string;
	prompt: string;
	createdBy?: string;
	nextRunAt: string;
}): number {
	const result = getDb()
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
	const result = getDb()
		.prepare("delete from scheduled_tasks where id = ?")
		.run(id);
	return result.changes > 0;
}

export function enableScheduledTask(id: number): boolean {
	const result = getDb()
		.prepare("update scheduled_tasks set enabled = 1 where id = ?")
		.run(id);
	return result.changes > 0;
}

export function disableScheduledTask(id: number): boolean {
	const result = getDb()
		.prepare("update scheduled_tasks set enabled = 0 where id = ?")
		.run(id);
	return result.changes > 0;
}

export function listScheduledTasks(): ScheduledTaskRow[] {
	return getDb()
		.prepare(`
    select id, name, type, schedule, channel_jid, prompt, enabled, last_run_at, next_run_at, created_at, created_by
    from scheduled_tasks
    order by id asc
  `)
		.all() as ScheduledTaskRow[];
}

export function getDueScheduledTasks(): ScheduledTaskRow[] {
	return getDb()
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
	getDb().prepare(`
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
	getDb().transaction(() => {
		enqueueMessage(msg);
		updateTaskAfterRun(taskId, lastRunAt, nextRunAt);
	})();
}
