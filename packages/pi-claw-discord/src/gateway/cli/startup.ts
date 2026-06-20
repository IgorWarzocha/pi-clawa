import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveConfigPath } from '../config.js';

export async function maybeRunFirstTimeSetup(): Promise<boolean> {
  const configPath = resolveConfigPath();
  if (existsSync(configPath)) return false;

  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!interactive) {
    throw new Error(
      `No config found at ${configPath}. Run "piscord setup" first, or set PIDG_CONFIG to point to your config file.`,
    );
  }

  console.log(`No config found at ${configPath}. Starting first-time setup...\n`);
  const { runSetup } = await import('./setup.js');
  await runSetup([]);
  return true;
}

export function isDirectExecution(metaUrl: string, argv = process.argv): boolean {
  const entry = argv[1];
  if (!entry) {
    return false;
  }

  try {
    return metaUrl === pathToFileURL(realpathSync(resolve(entry))).href;
  } catch {
    return metaUrl === pathToFileURL(resolve(entry)).href;
  }
}
