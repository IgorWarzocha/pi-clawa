import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { markClawBootstrapped } from './state'

const TEMPLATE_FILES = [
  'AGENTS.md',
  'IDENTITY.md',
  'SOUL.md',
  'TOOLS.md',
  'USER.md',
  'MEMORY.md',
  'CURIOUS.md',
] as const

export type BootstrapMode = 'standard'

export interface BootstrapResult {
  created: number
  overwritten: number
  files: string[]
  loadedFiles: Array<{ name: string; chars: number }>
  statePath: string
  mode: BootstrapMode
  targetPath: string
}

function writeBootstrapFiles(targetPath: string, templateDir: string) {
  let created = 0
  let overwritten = 0
  const files: string[] = []
  const writtenTargets: Array<{ name: string; path: string }> = []

  mkdirSync(targetPath, { recursive: true })

  for (const file of TEMPLATE_FILES) {
    const sourcePath = join(templateDir, file)
    const targetFilePath = join(targetPath, file)
    const content = readFileSync(sourcePath, 'utf8')

    if (existsSync(targetFilePath)) overwritten += 1
    else created += 1

    writeFileSync(targetFilePath, content, 'utf8')
    files.push(file)
    writtenTargets.push({ name: file, path: targetFilePath })
  }

  const loadedFiles = writtenTargets.map((file) => {
    const content = readFileSync(file.path, 'utf8')
    return { name: file.name, chars: content.length }
  })

  return { created, overwritten, files, loadedFiles }
}

export async function bootstrapClawWorkspace(
  targetPath: string,
  templateDir: string,
  mode: BootstrapMode = 'standard',
): Promise<BootstrapResult> {
  const written = writeBootstrapFiles(targetPath, templateDir)
  const statePath = await markClawBootstrapped(targetPath)
  return {
    ...written,
    statePath,
    mode,
    targetPath,
  }
}

export async function runBootstrap(
  cwd: string,
  templateDir: string,
  mode: BootstrapMode = 'standard',
): Promise<BootstrapResult> {
  return bootstrapClawWorkspace(cwd, templateDir, mode)
}
