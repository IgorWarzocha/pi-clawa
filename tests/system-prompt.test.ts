import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { filterClawaHomeContextFiles } from '../src/system-prompt.js'

test('Clawa context excludes global and parent instructions outside its home', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'clawa-contained-context-'))
  const root = join(parent, 'home')
  const worker = join(root, 'clawas', 'worker')
  const previousRoot = process.env['PI_CLAW_PROJECT_ROOT']
  try {
    await mkdir(join(root, '.pi'), { recursive: true })
    await mkdir(worker, { recursive: true })
    await writeFile(join(root, '.pi', 'settings.json'), '{}', 'utf8')
    const globalFile = { path: join(parent, 'global', 'AGENTS.MD'), content: 'GLOBAL' }
    const parentFile = { path: join(parent, 'AGENTS.md'), content: 'PARENT' }
    const rootFile = { path: join(root, 'AGENTS.md'), content: 'HOME' }
    const workerFile = { path: join(worker, 'AGENTS.md'), content: 'WORKER' }
    const contextFiles = [globalFile, parentFile, rootFile, workerFile]
    await mkdir(join(parent, 'global'), { recursive: true })
    for (const file of contextFiles) await writeFile(file.path, file.content, 'utf8')
    process.env['PI_CLAW_PROJECT_ROOT'] = root

    assert.deepEqual(filterClawaHomeContextFiles(contextFiles, worker), [rootFile, workerFile])
  } finally {
    if (previousRoot === undefined) delete process.env['PI_CLAW_PROJECT_ROOT']
    else process.env['PI_CLAW_PROJECT_ROOT'] = previousRoot
    await rm(parent, { recursive: true, force: true })
  }
})

test('global agent context stays excluded when its directory is inside the home', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-global-agent-dir-'))
  try {
    const globalAgentDir = join(root, '.pi', 'agent')
    await mkdir(globalAgentDir, { recursive: true })
    await writeFile(join(root, '.pi', 'settings.json'), '{}', 'utf8')
    const homeFile = { path: join(root, 'AGENTS.md'), content: 'HOME' }
    const globalFile = { path: join(globalAgentDir, 'AGENTS.MD'), content: 'GLOBAL' }
    await writeFile(homeFile.path, homeFile.content, 'utf8')
    await writeFile(globalFile.path, globalFile.content, 'utf8')

    assert.deepEqual(filterClawaHomeContextFiles([globalFile, homeFile], root, globalAgentDir), [
      homeFile,
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('missing and dangling context paths fail closed', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'clawa-dangling-context-'))
  const root = join(parent, 'home')
  const outside = join(parent, 'outside-AGENTS.md')
  const linked = join(root, 'linked-AGENTS.md')
  try {
    await mkdir(join(root, '.pi'), { recursive: true })
    await writeFile(join(root, '.pi', 'settings.json'), '{}', 'utf8')
    await writeFile(outside, 'OUTSIDE', 'utf8')
    await symlink(outside, linked)
    await rm(outside)

    assert.deepEqual(
      filterClawaHomeContextFiles(
        [
          { path: linked, content: 'OUTSIDE' },
          { path: join(root, 'missing-AGENTS.md'), content: 'MISSING' },
        ],
        root,
      ),
      [],
    )
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})
