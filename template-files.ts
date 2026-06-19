import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'

export interface TemplateCopyResult {
  copied: string[]
  skipped: string[]
}

export async function copyTemplateFiles(
  templateDir: string,
  targetDir: string,
): Promise<TemplateCopyResult> {
  await mkdir(targetDir, { recursive: true })

  const copied: string[] = []
  const skipped: string[] = []
  const entries = await readdir(templateDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isFile()) continue

    const targetPath = join(targetDir, entry.name)
    if (existsSync(targetPath)) {
      skipped.push(entry.name)
      continue
    }

    await copyFile(join(templateDir, entry.name), targetPath)
    copied.push(entry.name)
  }

  return { copied, skipped }
}
