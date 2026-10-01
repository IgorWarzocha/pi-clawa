import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../website/scripts/prepare-legacy.mjs', import.meta.url))
const docPath = 'website/src/content/docs/guide/home.md'
const doc =
  '---\ntitle: Home\ndescription: A home.\nsection: Core concepts\norder: 1\n---\n\nlegacy\n'
const resolutionPattern = /refs\/heads\/legacy -> [0-9a-f]{40}/
const missingPattern = /Cannot resolve legacy source/
const invalidOverridePattern = /CLAWA_LEGACY_REF must not be empty/
const missingContentPattern = /must contain CHANGELOG.md and Markdown docs/
const missingFrontmatterPattern = /Missing frontmatter/
const invalidTextPattern = /Invalid text/
const regularFilesPattern = /must be regular files/

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'clawa-docs-'))
  try {
    git(root, 'init', '-q', '--initial-branch=modern')
    git(root, 'config', 'user.email', 'fixture@example.invalid')
    git(root, 'config', 'user.name', 'Fixture')
    git(root, 'config', 'commit.gpgsign', 'false')
    git(root, 'config', 'core.hooksPath', '/dev/null')
    await put(root, '.gitignore', 'website/.generated/\n')
    await put(root, docPath, doc)
    await put(root, 'CHANGELOG.md', '# Changelog\n\nLegacy release.\n')
    commit(root)
    git(root, 'branch', 'legacy')
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function git(root: string, ...args: string[]) {
  return execFileSync('git', ['-C', root, ...args])
    .toString()
    .trim()
}

async function put(root: string, path: string, content: string) {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), content)
}

function commit(root: string) {
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'fixture')
  return git(root, 'rev-parse', 'HEAD')
}

function prepare(root: string, ref?: string) {
  const env = { ...process.env }
  delete env['CLAWA_LEGACY_REF']
  if (ref !== undefined) env['CLAWA_LEGACY_REF'] = ref
  return spawnSync(process.execPath, [script], { cwd: root, env, encoding: 'utf8' })
}

test('legacy snapshot reads one preserved commit, not modern or dirty worktree content', async () =>
  fixture(async (root) => {
    await put(root, docPath, doc.replace('legacy\n', 'modern\n'))
    await put(root, 'CHANGELOG.md', '# Changelog\n\nModern release.\n')
    const modern = commit(root)
    git(root, 'update-ref', 'refs/remotes/origin/legacy', modern)
    await put(root, docPath, 'dirty worktree')
    const result = prepare(root)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, resolutionPattern)
    assert.equal(
      await readFile(join(root, 'website/.generated/legacy/docs/guide/home.md'), 'utf8'),
      doc,
    )
    assert.equal(
      await readFile(join(root, 'website/.generated/legacy/CHANGELOG.md'), 'utf8'),
      '# Changelog\n\nLegacy release.\n',
    )
    const override = prepare(root, modern)
    assert.equal(override.status, 0, override.stderr)
    assert.equal(
      await readFile(join(root, 'website/.generated/legacy/CHANGELOG.md'), 'utf8'),
      '# Changelog\n\nModern release.\n',
    )
  }))

test('remote-tracking legacy is visible fallback and explicit invalid overrides fail closed', async () =>
  fixture(async (root) => {
    const sha = git(root, 'rev-parse', 'legacy')
    git(root, 'update-ref', 'refs/remotes/origin/legacy', sha)
    git(root, 'branch', '-D', 'legacy')
    const fallback = prepare(root)
    assert.equal(fallback.status, 0, fallback.stderr)
    assert.ok(fallback.stdout.includes(`refs/remotes/origin/legacy -> ${sha}`))
    const invalid = prepare(root, 'missing-ref')
    assert.equal(invalid.status, 1)
    assert.match(invalid.stderr, missingPattern)
    assert.match(prepare(root, '').stderr, invalidOverridePattern)
    git(root, 'update-ref', '-d', 'refs/remotes/origin/legacy')
    const missing = prepare(root)
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, missingPattern)
  }))

test('snapshot replacement removes stale documents and never leaves staging directories', async () =>
  fixture(async (root) => {
    assert.equal(prepare(root).status, 0)
    await rm(join(root, docPath))
    await put(root, 'website/src/content/docs/start.md', doc)
    const next = commit(root)
    git(root, 'update-ref', 'refs/heads/legacy', next)
    assert.equal(prepare(root).status, 0)
    await assert.rejects(readFile(join(root, 'website/.generated/legacy/docs/guide/home.md')))
    assert.deepEqual(await readdir(join(root, 'website/.generated')), ['legacy'])
  }))

test('missing, malformed and symlinked archive content aborts preparation', async () =>
  fixture(async (root) => {
    await rm(join(root, 'CHANGELOG.md'))
    const missing = prepare(root, commit(root))
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, missingContentPattern)
    await put(root, 'CHANGELOG.md', '# Changelog\n')
    await put(root, docPath, 'not frontmatter')
    const malformed = prepare(root, commit(root))
    assert.equal(malformed.status, 1)
    assert.match(malformed.stderr, missingFrontmatterPattern)
    await put(root, docPath, '')
    const empty = prepare(root, commit(root))
    assert.equal(empty.status, 1)
    assert.match(empty.stderr, invalidTextPattern)
    await rm(join(root, docPath))
    git(
      root,
      'update-index',
      '--add',
      '--cacheinfo',
      '120000',
      git(root, 'hash-object', 'CHANGELOG.md'),
      docPath,
    )
    git(root, 'commit', '-qm', 'symlink')
    const symlinked = prepare(root, 'HEAD')
    assert.equal(symlinked.status, 1)
    assert.match(symlinked.stderr, regularFilesPattern)
    assert.deepEqual(await readdir(join(root, 'website/.generated')), [])
  }))
