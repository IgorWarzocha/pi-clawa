import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  copyTemplateFiles,
  findExistingTemplateFiles,
  hasAllTemplateFiles,
} from './template-files.js'

test('template helpers detect existing files and copy templates assertively', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clawa-templates-'))
  const source = join(dir, 'source')
  const target = join(dir, 'target')
  try {
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'AGENTS.md'), 'template agents', 'utf8')
    await writeFile(join(source, 'SOUL.md'), 'template soul', 'utf8')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'SOUL.md'), 'existing soul', 'utf8')

    assert.deepEqual(await findExistingTemplateFiles(source, target), ['SOUL.md'])
    assert.equal(await hasAllTemplateFiles(source, target), false)

    const result = await copyTemplateFiles(source, target)

    assert.deepEqual(result.copied.sort(), ['AGENTS.md', 'SOUL.md'].sort())
    assert.equal(await readFile(join(target, 'AGENTS.md'), 'utf8'), 'template agents')
    assert.equal(await readFile(join(target, 'SOUL.md'), 'utf8'), 'template soul')
    assert.equal(await hasAllTemplateFiles(source, target), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
