export async function reportError(command: string | undefined, err: unknown): Promise<void> {
  const message = errorMessage(err);

  if (command === 'start') {
    const [{ closeDb }, { stopDiscord }, { logger }] = await Promise.all([
      import('../db.js'),
      import('../discord/client.js'),
      import('../logger.js'),
    ]);

    logger.fatal({ err: message }, 'Gateway exited with error');
    stopDiscord();
    closeDb();
    return;
  }

  console.error(`Error: ${message}`);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
