import { existsSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path'

function normalizeAtPrefix(inputPath: string): string {
  return inputPath.startsWith('@') ? inputPath.slice(1) : inputPath
}

function realpathMaybe(path: string): string {
  return existsSync(path) ? (realpathSync.native?.(path) ?? realpathSync(path)) : path
}

export function resolvePath(targetPath: string, baseDir: string): string {
  const cleaned = normalizeAtPrefix(targetPath)
  const absolute = isAbsolute(cleaned) ? normalize(cleaned) : resolve(baseDir, cleaned)
  try {
    return realpathMaybe(absolute)
  } catch {
    return absolute
  }
}

function isInsideRoot(rootDir: string, targetPath: string): boolean {
  if (!rootDir) return false
  const rel = relative(rootDir, targetPath)
  return rel === '' || !(rel.startsWith('..') || isAbsolute(rel))
}

export function contentRootForTarget(targetPath: string): string {
  try {
    const startDir =
      existsSync(targetPath) && statSync(targetPath).isDirectory()
        ? targetPath
        : dirname(targetPath)
    let dir = startDir
    let best = ''
    while (true) {
      if (existsSync(join(dir, 'AGENTS.md'))) best = dir
      if (existsSync(join(dir, '.git'))) return dir
      const parent = dirname(dir)
      if (parent === dir) return best || startDir
      dir = parent
    }
  } catch {
    return ''
  }
}

export function agentsFromCwdToRoot(cwd: string): Set<string> {
  const ignored = new Set<string>()
  const root = contentRootForTarget(cwd)
  if (!root) return ignored
  let dir = cwd
  while (isInsideRoot(root, dir)) {
    const candidate = join(dir, 'AGENTS.md')
    if (existsSync(candidate)) ignored.add(normalize(candidate))
    if (dir === root) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return ignored
}

export function findAgentsFiles(
  filePath: string,
  rootDir: string,
  ignoredAgents: Set<string>,
): string[] {
  if (!rootDir) return []
  const agentsFiles: string[] = []
  let dir = dirname(filePath)
  while (isInsideRoot(rootDir, dir)) {
    const candidate = normalize(join(dir, 'AGENTS.md'))
    if (!ignoredAgents.has(candidate) && existsSync(candidate)) agentsFiles.push(candidate)
    if (dir === rootDir) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return agentsFiles.reverse()
}

export function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory()
  } catch {
    return false
  }
}

export function isAgentsFile(path: string): boolean {
  return basename(path) === 'AGENTS.md'
}
