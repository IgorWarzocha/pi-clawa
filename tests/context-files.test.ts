import assert from 'node:assert/strict'
import {
  mkdtemp,
  readFile as readDisk,
  rm,
  symlink,
  writeFile as writeDisk,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  appendFile,
  listFiles,
  readFile,
  searchFiles,
  writeFile,
} from '../src/context-management/files/files.js'
import { withWriteLock } from '../src/context-management/files/write-lock.js'

const signal = new AbortController().signal
const ComponentsPattern = /components/
const RelativePattern = /relative/
const LinksPattern = /links/
const FailedPattern = /failed/
const DonePattern = /done$/
const AbortPattern = /abort/i
const ConflictPattern = /changed since it was read/

async function home(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'clawa-files-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('file root is explicit, relative, and cannot traverse links or dot components', async () =>
  home(async (house) => {
    const root = join(house, 'notes')
    await writeFile(root, { path: 'a.md', text: 'one\ntwo\nthree' }, signal)
    assert.equal((await listFiles(root, {}, signal)).files[0]?.path, 'a.md')
    assert.equal((await searchFiles(root, { query: 'two' }, signal)).results[0]?.path, 'a.md')
    assert.equal(
      (await readFile(root, { path: 'a.md', start_line: -2, stop_line: -1 }, signal)).file.content,
      'two\nthree',
    )
    assert.equal(
      (await readFile(root, { path: 'a.md', start_line: 3, stop_line: 2 }, signal)).file.content,
      '',
    )
    await assert.rejects(
      writeFile(root, { path: '../escape.md', text: 'bad' }, signal),
      ComponentsPattern,
    )
    await assert.rejects(readFile(root, { path: '/etc/passwd' }, signal), RelativePattern)
    await symlink(house, join(root, 'linked'))
    await symlink(join(house, 'outside.md'), join(root, 'link.md'))
    await writeDisk(join(house, 'outside.md'), 'outside')
    await assert.rejects(
      writeFile(root, { path: 'linked/escape.md', text: 'bad' }, signal),
      LinksPattern,
    )
    await assert.rejects(readFile(root, { path: 'link.md' }, signal))
    assert.deepEqual(
      (await listFiles(root, {}, signal)).files.map((file) => file.path),
      ['a.md'],
    )
    assert.equal(await readDisk(join(house, 'outside.md'), 'utf8'), 'outside')
  }))

test('concurrent appends serialize without losing any writes, and failure releases the lock', async () =>
  home(async (house) => {
    const root = join(house, 'memory')
    await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        appendFile(root, { path: 'log.md', text: `${index}\n` }, signal),
      ),
    )
    const lines = (await readFile(root, { path: 'log.md' }, signal)).file.content.trim().split('\n')
    assert.deepEqual(
      lines.map(Number).sort((a, b) => a - b),
      Array.from({ length: 24 }, (_, index) => index),
    )
    await assert.rejects(
      withWriteLock(root, signal, async () => {
        throw new Error('failed')
      }),
      FailedPattern,
    )
    await appendFile(root, { path: 'log.md', text: 'done' }, signal)
    assert.match((await readFile(root, { path: 'log.md' }, signal)).file.content, DonePattern)
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      appendFile(root, { path: 'log.md', text: 'nope' }, controller.signal),
      AbortPattern,
    )
  }))

test('version checks fence concurrent replacements and create-only writes inside the lock', async () =>
  home(async (root) => {
    await writeFile(root, { path: 'topic.md', text: 'original', expected_version: null }, signal)
    const version = (await readFile(root, { path: 'topic.md' }, signal)).file.version
    const outcomes = await Promise.allSettled(
      ['first', 'second'].map((text) =>
        writeFile(root, { path: 'topic.md', text, expected_version: version }, signal),
      ),
    )
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1)
    const winner = await readDisk(join(root, 'topic.md'), 'utf8')
    assert.ok(winner === 'first' || winner === 'second')
    await assert.rejects(
      writeFile(root, { path: 'topic.md', text: 'stale', expected_version: version }, signal),
      ConflictPattern,
    )
    await assert.rejects(
      writeFile(root, { path: 'topic.md', text: 'replace', expected_version: null }, signal),
      ConflictPattern,
    )
    assert.equal(await readDisk(join(root, 'topic.md'), 'utf8'), winner)
    await writeFile(
      root,
      { path: 'new/nested.md', text: 'created', expected_version: null },
      signal,
    )
    assert.equal(await readDisk(join(root, 'new', 'nested.md'), 'utf8'), 'created')
  }))
