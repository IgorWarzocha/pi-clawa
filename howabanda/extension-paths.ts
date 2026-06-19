import * as fs from 'node:fs'
import * as path from 'node:path'
import type { WorkerDefinition } from './types.js'

export function discoverProjectExtensionPaths(_projectRoot: string): string[] {
  const envExtensionPath = process.env.PI_CLAW_EXTENSION_PATH?.trim()
  if (
    envExtensionPath &&
    fs.existsSync(envExtensionPath) &&
    fs.statSync(envExtensionPath).isFile()
  ) {
    return [envExtensionPath]
  }

  return []
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
