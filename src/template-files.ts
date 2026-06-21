import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface TemplateCopyResult {
  copied: string[]
  loadedFiles: Array<{ name: string; chars: number }>
}

const CORE_MARKDOWN_FILES = [
  'AGENTS.md',
  'CLAW.md',
  'HUMAN.md',
  'CLAWAS.md',
  'TOOLS.md',
  'CURIOUS.md',
] as const
async function templateFileNames(templateDir: string, prefix = ''): Promise<string[]> {
  const dir = join(templateDir, prefix)
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const relative = join(prefix, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await templateFileNames(templateDir, relative)))
      continue
    }
    if (entry.isFile()) files.push(relative)
  }
  return files.sort()
}

export function hasAllCoreMarkdownFiles(targetDir: string): boolean {
  return CORE_MARKDOWN_FILES.every((file) => existsSync(join(targetDir, file)))
}

export function findExistingCoreMarkdownFiles(targetDir: string): string[] {
  return CORE_MARKDOWN_FILES.filter((file) => existsSync(join(targetDir, file)))
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
    await mkdir(dirname(targetPath), { recursive: true })
    await copyFile(sourcePath, targetPath)
    copied.push(file)
    loadedFiles.push({ name: file, chars: readFileSync(targetPath, 'utf8').length })
  }

  return { copied, loadedFiles }
}
