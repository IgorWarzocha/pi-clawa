import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'

export interface TemplateCopyResult {
  copied: string[]
  loadedFiles: Array<{ name: string; chars: number }>
}

const CORE_MARKDOWN_FILES = ['AGENTS.md', 'CLAW.md', 'HUMAN.md', 'TOOLS.md', 'CURIOUS.md'] as const
const LEGACY_CORE_MARKDOWN_FILES = [
  'IDENTITY.md',
  'SOUL.md',
  'USER.md',
  'MEMORY.md',
  'TECHNICAL.md',
] as const

async function templateFileNames(templateDir: string): Promise<string[]> {
  const entries = await readdir(templateDir, { withFileTypes: true })
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
}

export async function findExistingTemplateFiles(
  templateDir: string,
  targetDir: string,
): Promise<string[]> {
  const files = await templateFileNames(templateDir)
  return files.filter((file) => existsSync(join(targetDir, file)))
}

export async function hasAllTemplateFiles(
  templateDir: string,
  targetDir: string,
): Promise<boolean> {
  const files = await templateFileNames(templateDir)
  return files.length > 0 && files.every((file) => existsSync(join(targetDir, file)))
}

export function hasAllCoreMarkdownFiles(targetDir: string): boolean {
  return CORE_MARKDOWN_FILES.every((file) => existsSync(join(targetDir, file)))
}

export function findExistingCoreMarkdownFiles(targetDir: string): string[] {
  return [...CORE_MARKDOWN_FILES, ...LEGACY_CORE_MARKDOWN_FILES].filter((file) =>
    existsSync(join(targetDir, file)),
  )
}

export async function copyTemplateFiles(
  templateDir: string,
  targetDir: string,
): Promise<TemplateCopyResult> {
  await mkdir(targetDir, { recursive: true })

  const copied: string[] = []
  const loadedFiles: Array<{ name: string; chars: number }> = []
  const files = await templateFileNames(templateDir)

  for (const file of files) {
    const sourcePath = join(templateDir, file)
    const targetPath = join(targetDir, file)
    await copyFile(sourcePath, targetPath)
    copied.push(file)
    loadedFiles.push({ name: file, chars: readFileSync(targetPath, 'utf8').length })
  }

  return { copied, loadedFiles }
}
