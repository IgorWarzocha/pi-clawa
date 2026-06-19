import * as fs from 'node:fs'
import * as path from 'node:path'
import type { WorkerDefinition } from './types.js'

function firstExistingPath(paths: string[]): string | null {
  for (const filePath of paths) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return filePath
    }
  }
  return null
}

export function discoverProjectExtensionPaths(projectRoot: string): string[] {
  const envExtensionPath = process.env.PI_CLAW_EXTENSION_PATH?.trim()
  if (
    envExtensionPath &&
    fs.existsSync(envExtensionPath) &&
    fs.statSync(envExtensionPath).isFile()
  ) {
    return [envExtensionPath]
  }

  const howabouaClawExtension = firstExistingPath([
    path.join(projectRoot, '.pi', 'extensions', 'howaboua-claw', 'index.ts'),
    path.join(projectRoot, '.pi', 'extensions', 'howaboua-claw', 'index.js'),
  ])

  if (howabouaClawExtension) {
    return [howabouaClawExtension]
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
