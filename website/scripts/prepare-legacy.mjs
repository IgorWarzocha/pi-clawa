import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { TextDecoder } from 'node:util'

const docsPrefix = 'website/src/content/docs/'
const decoder = new TextDecoder('utf-8', { fatal: true })
const frontmatter = /^---\r?\n[\s\S]+?\r?\n---(?:\r?\n|$)/

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function resolveSource(root) {
  const override = process.env.CLAWA_LEGACY_REF
  if (override !== undefined && override.trim() === '') {
    throw new Error('CLAWA_LEGACY_REF must not be empty')
  }
  const refs =
    override === undefined ? ['refs/heads/legacy', 'refs/remotes/origin/legacy'] : [override]
  for (const ref of refs) {
    try {
      const commit = git(root, 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`)
        .toString()
        .trim()
      return { ref, commit }
    } catch {
      // An explicit override must never silently fall back to another edition.
    }
  }
  throw new Error(
    `Cannot resolve legacy source (${refs.join(', ')}). Fetch origin/legacy or set CLAWA_LEGACY_REF to a preserved legacy commit.`,
  )
}

function readText(content, path) {
  const text = decoder.decode(content)
  if (!text.trim() || text.includes('\0')) throw new Error(`Invalid text in legacy ${path}`)
  return text
}

function readEntry(root, commit, entry) {
  const tab = entry.indexOf('\t')
  const path = entry.slice(tab + 1)
  const [mode, type] = entry.slice(0, tab).split(' ')
  if (type !== 'blob' || (mode !== '100644' && mode !== '100755')) {
    throw new Error(`Legacy content must be regular files: ${path}`)
  }
  const relative = path === 'CHANGELOG.md' ? path : `docs/${path.slice(docsPrefix.length)}`
  if (relative.split('/').some((part) => part === '..' || part === '.' || part === '')) {
    throw new Error(`Invalid legacy content path: ${path}`)
  }
  const content = git(root, 'cat-file', 'blob', `${commit}:${path}`)
  if (!path.endsWith('.md')) return { relative, content, kind: 'asset' }
  const text = readText(content, path)
  if (path === 'CHANGELOG.md') return { relative, content, kind: 'changelog' }
  if (!frontmatter.test(text)) throw new Error(`Missing frontmatter in legacy ${path}`)
  // Astro's native loader validates both editions against the same frontmatter schema.
  return { relative, content, kind: 'doc' }
}

async function prepareLegacy() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel']).toString().trim()
  const source = resolveSource(root)
  console.log(`[legacy] ${source.ref} -> ${source.commit}`)
  const entries = git(root, 'ls-tree', '-r', '-z', source.commit, '--', docsPrefix, 'CHANGELOG.md')
    .toString()
    .split('\0')
    .filter(Boolean)
  const generated = join(root, 'website', '.generated')
  await mkdir(generated, { recursive: true })
  const staging = await mkdtemp(join(generated, 'legacy-'))
  try {
    let docCount = 0
    let hasChangelog = false
    for (const entry of entries) {
      const { relative, content, kind } = readEntry(root, source.commit, entry)
      if (kind === 'doc') docCount += 1
      if (kind === 'changelog') hasChangelog = true
      const destination = join(staging, relative)
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, content)
    }
    if (!hasChangelog || docCount === 0) {
      throw new Error('Legacy commit must contain CHANGELOG.md and Markdown docs')
    }
    const destination = join(generated, 'legacy')
    await rm(destination, { recursive: true, force: true })
    await rename(staging, destination)
    console.log(`[legacy] prepared ${docCount} docs and CHANGELOG.md`)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

try {
  await prepareLegacy()
} catch (error) {
  console.error(
    `[legacy] Snapshot failed: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exitCode = 1
}
