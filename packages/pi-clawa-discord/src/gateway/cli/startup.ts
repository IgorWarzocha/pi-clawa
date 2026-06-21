import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveConfigPath } from '../config.js';

export async function maybeRunFirstTimeSetup(): Promise<boolean> {
  const configPath = resolveConfigPath();
  if (existsSync(configPath)) return false;
  throw new Error(
    `No Discord config found at ${configPath}. Start Pi with the adapter and use /discord to create it.`,
  );
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
