import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'

export interface TemplateCopyResult {
  copied: string[]
}

export async function copyTemplateFiles(
  templateDir: string,
  targetDir: string,
): Promise<TemplateCopyResult> {
  await mkdir(targetDir, { recursive: true })

  const copied: string[] = []
  const entries = await readdir(templateDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isFile()) continue

    await copyFile(join(templateDir, entry.name), join(targetDir, entry.name))
    copied.push(entry.name)
  }

  return { copied }
}
