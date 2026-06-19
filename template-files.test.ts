import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { copyTemplateFiles } from './template-files.js'

test('copyTemplateFiles copies files and overwrites existing files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clawa-templates-'))
  const source = join(dir, 'source')
  const target = join(dir, 'target')
  try {
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'AGENTS.md'), 'template agents', 'utf8')
    await writeFile(join(source, 'MEMORY.md'), 'template memory', 'utf8')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'MEMORY.md'), 'existing memory', 'utf8')

    const result = await copyTemplateFiles(source, target)

    assert.deepEqual(result.copied.sort(), ['AGENTS.md', 'MEMORY.md'].sort())
    assert.equal(await readFile(join(target, 'AGENTS.md'), 'utf8'), 'template agents')
    assert.equal(await readFile(join(target, 'MEMORY.md'), 'utf8'), 'template memory')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
