import * as fs from 'node:fs'
import * as path from 'node:path'
import type { WorkerDefinition } from './types.js'

export function discoverProjectExtensionPaths(_projectRoot: string): string[] {
  return [process.env['PI_CLAW_EXTENSION_PATH'], process.env['PI_CLAW_DISCORD_EXTENSION_PATH']]
    .map((extensionPath) => extensionPath?.trim())
    .filter((extensionPath): extensionPath is string =>
      Boolean(
        extensionPath &&
          path.isAbsolute(extensionPath) &&
          fs.existsSync(extensionPath) &&
          fs.statSync(extensionPath).isFile(),
      ),
    )
}

export function resolveWorkerExtensionPaths(
  projectRoot: string,
  baseExtensions: string[],
  definition: WorkerDefinition,
): string[] {
  const workerExtensions = (definition.extensions ?? [])
    .map((extensionPath) =>
      path.isAbsolute(extensionPath) ? extensionPath : path.resolve(projectRoot, extensionPath),
    )
    .filter((extensionPath) => fs.existsSync(extensionPath) && fs.statSync(extensionPath).isFile())

  return [...new Set([...baseExtensions, ...workerExtensions])]
}
