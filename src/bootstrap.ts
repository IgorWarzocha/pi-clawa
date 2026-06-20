import { copyTemplateFiles } from './template-files.js'

export type BootstrapMode = 'standard'

export interface BootstrapResult {
  created: number
  overwritten: number
  files: string[]
  loadedFiles: Array<{ name: string; chars: number }>
  mode: BootstrapMode
  targetPath: string
}

export async function bootstrapClawWorkspace(
  targetPath: string,
  templateDir: string,
  mode: BootstrapMode = 'standard',
): Promise<BootstrapResult> {
  const copied = await copyTemplateFiles(templateDir, targetPath)
  return {
    created: copied.copied.length,
    overwritten: 0,
    files: copied.copied,
    loadedFiles: copied.loadedFiles,
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
