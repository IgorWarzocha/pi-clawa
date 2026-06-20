export async function cliArchive(args: string[]): Promise<void> {
  const [subcommand, ...subArgs] = args;

  switch (subcommand) {
    case 'list':
      await cliArchiveList();
      return;
    case 'cleanup':
      await cliArchiveCleanup(subArgs);
      return;
    default:
      throw new Error('Usage: piscord archive <list|cleanup [--dry-run]>');
  }
}

async function cliArchiveList(): Promise<void> {
  const [{ listArchivedSessions }, { config }] = await Promise.all([
    import('../session/archive-cleanup.js'),
    import('../config.js'),
  ]);

  const archivedSessions = listArchivedSessions(config.sessionsDir);
  if (archivedSessions.length === 0) {
    console.log(`No archived sessions found in ${config.sessionsDir}.`);
    return;
  }

  const now = Date.now();
  console.log(`Archived sessions (${archivedSessions.length}) in ${config.sessionsDir}:\n`);

  for (const archived of archivedSessions) {
    console.log(
      `  ${archived.name}  archived=${archived.archivedAt.toISOString()}  age=${formatAge(archived.archivedAt, now)}`,
    );
  }
}

async function cliArchiveCleanup(args: string[]): Promise<void> {
  const dryRun = args.includes('--dry-run');
  const unknownArgs = args.filter((arg) => arg !== '--dry-run');
  if (unknownArgs.length > 0) {
    throw new Error('Usage: piscord archive cleanup [--dry-run]');
  }

  const [{ cleanupArchivedSessions }, { config }] = await Promise.all([
    import('../session/archive-cleanup.js'),
    import('../config.js'),
  ]);

  if (config.archiveRetentionDays === 0) {
    console.log('Archive cleanup is disabled (ARCHIVE_RETENTION_DAYS=0).');
    return;
  }

  const result = cleanupArchivedSessions(config.sessionsDir, config.archiveRetentionDays, { dryRun });
  if (result.deleted.length === 0) {
    console.log(`No archived sessions ${dryRun ? 'would be deleted' : 'were deleted'}.`);
  } else {
    console.log(`${dryRun ? 'Would delete' : 'Deleted'} ${result.deleted.length} archived session directories:`);
    for (const deleted of result.deleted) {
      console.log(`  ${deleted}`);
    }
  }

  console.log(`Skipped ${result.skipped} archived ${result.skipped === 1 ? 'session' : 'sessions'}.`);
}

function formatAge(date: Date, now = Date.now()): string {
  const diff = Math.max(0, now - date.getTime());
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return `${minutes}m`;
}
