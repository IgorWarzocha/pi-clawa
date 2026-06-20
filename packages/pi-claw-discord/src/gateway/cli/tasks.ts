import { toDiscordChannelJid } from './channel-id.js';
import { withDb } from './db-context.js';

export async function cliTask(args: string[]): Promise<void> {
  const [subcommand, ...subArgs] = args;

  switch (subcommand) {
    case 'add':
      await cliAddTask(subArgs);
      return;
    case 'list':
      await cliListTasks();
      return;
    case 'remove':
      await cliRemoveTask(subArgs);
      return;
    case 'enable':
      await cliEnableTask(subArgs);
      return;
    case 'disable':
      await cliDisableTask(subArgs);
      return;
    default:
      throw new Error('Usage: piscord task <add|list|remove|enable|disable> [options]');
  }
}

async function cliAddTask(args: string[]): Promise<void> {
  const options = parseTaskAddOptions(args);
  const { computeNextRun } = await import('../agent/scheduler.js');
  const nextRunAt = computeNextRun(options.schedule, options.type);

  if (!nextRunAt) {
    throw new Error('Schedule does not produce a future run time.');
  }

  await withDb(({ addScheduledTask }) => {
    const id = addScheduledTask({
      name: options.name,
      type: options.type,
      schedule: options.schedule,
      channelJid: toDiscordChannelJid(options.channel),
      prompt: options.prompt,
      createdBy: 'cli',
      nextRunAt,
    });

    console.log(`Scheduled task added: ${id}`);
  });
}

async function cliListTasks(): Promise<void> {
  await withDb(({ listScheduledTasks }) => {
    const tasks = listScheduledTasks();
    if (tasks.length === 0) {
      console.log('No scheduled tasks.');
      return;
    }

    console.table(tasks.map((task) => ({
      id: task.id,
      name: task.name,
      type: task.type,
      schedule: task.schedule,
      channel: task.channel_jid,
      enabled: task.enabled,
      next_run_at: task.next_run_at ?? '',
    })));
  });
}

async function cliRemoveTask(args: string[]): Promise<void> {
  const id = parseTaskId(args[0], 'Usage: piscord task remove <id>');

  await withDb(({ removeScheduledTask }) => {
    const removed = removeScheduledTask(id);
    console.log(removed ? `Removed scheduled task: ${id}` : `Scheduled task not found: ${id}`);
  });
}

async function cliEnableTask(args: string[]): Promise<void> {
  const id = parseTaskId(args[0], 'Usage: piscord task enable <id>');

  await withDb(({ enableScheduledTask }) => {
    const enabled = enableScheduledTask(id);
    console.log(enabled ? `Enabled scheduled task: ${id}` : `Scheduled task not found: ${id}`);
  });
}

async function cliDisableTask(args: string[]): Promise<void> {
  const id = parseTaskId(args[0], 'Usage: piscord task disable <id>');

  await withDb(({ disableScheduledTask }) => {
    const disabled = disableScheduledTask(id);
    console.log(disabled ? `Disabled scheduled task: ${id}` : `Scheduled task not found: ${id}`);
  });
}

function parseTaskAddOptions(args: string[]): {
  name: string;
  type: 'once' | 'recurring';
  schedule: string;
  channel: string;
  prompt: string;
} {
  const options: {
    name?: string;
    type: 'once' | 'recurring';
    schedule?: string;
    channel?: string;
    prompt?: string;
  } = {
    type: 'recurring',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--name':
        options.name = args[++i];
        break;
      case '--schedule':
        options.schedule = args[++i];
        break;
      case '--channel':
        options.channel = args[++i];
        break;
      case '--prompt':
        options.prompt = args[++i];
        break;
      case '--once':
        options.type = 'once';
        break;
      default:
        throw new Error(
          'Usage: piscord task add --name <n> --schedule <cron|iso> --channel <jid> --prompt <text> [--once]',
        );
    }
  }

  if (!options.name || !options.schedule || !options.channel || !options.prompt) {
    throw new Error(
      'Usage: piscord task add --name <n> --schedule <cron|iso> --channel <jid> --prompt <text> [--once]',
    );
  }

  return {
    name: options.name,
    type: options.type,
    schedule: options.schedule,
    channel: options.channel,
    prompt: options.prompt,
  };
}

function parseTaskId(raw: string | undefined, usage: string): number {
  if (!raw) {
    throw new Error(usage);
  }

  const id = Number.parseInt(raw, 10);
  if (Number.isNaN(id)) {
    throw new Error(usage);
  }

  return id;
}
